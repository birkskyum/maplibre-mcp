import {parse} from '@babel/parser';
import type {ClassBody, Identifier, Node, Statement, StringLiteral, TSEntityName, TSType, TSTypeAliasDeclaration, TSTypeElement} from '@babel/types';
import type {McpServer} from '@modelcontextprotocol/server';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {z} from 'zod';
import {suggestNames} from '../../suggest.js';
import {MAPLIBRE_VERSION} from './renderer.js';

type Kind = 'class' | 'interface' | 'type' | 'function' | 'enum' | 'variable';

type MemberKind = 'constructor' | 'method' | 'property' | 'value';

/** A class, interface, type, function, enum or constant in the type definitions of GL JS. */
type Declaration = {
    /** The name GL JS exports it as, or for a declaration it doesn't export, its name without the bundler's `$1`. */
    name: string;
    kind: Kind;
    exported: boolean;
    /** The declaration as the type definitions write it, or each overload of a function. */
    signatures: Signature[];
    members: Member[];
    /** The declarations whose members this one has too, like the class it extends, by their names in the file. */
    bases: string[];
};

type Parts = Omit<Declaration, 'name' | 'exported'>;

type Member = {name: string; kind: MemberKind; isStatic: boolean; signatures: Signature[]};

type Signature = {text: string; doc: Doc};

/** A documentation comment: its text before the first tag, and tags like `@param` and `@example`. */
type Doc = {text: string; tags: Tag[]};

type Tag = {name: string; text: string};

/** A member as a lookup reaches it: the declaration that declares it, and the exported one to show it on. */
type Reached = {member: Member; declaredIn: Declaration; shownOn: Declaration};

/** The type definitions of one GL JS version. */
type Api = {
    version: string;
    /** By the names GL JS exports them as. */
    declarations: Map<string, Declaration>;
    /** By their names in the file, which bases refer to. */
    local: Map<string, Declaration>;
    /** The members of the exported declarations, inherited ones included, by member name. */
    members: Map<string, Reached[]>;
};

/** Returns the source text between two positions, without comments, on one line, and with the exported names. */
type Text = (start: number | null | undefined, end: number | null | undefined) => string;

const DOCS = 'https://maplibre.org/maplibre-gl-js/docs/API/';
const DOCS_FOLDERS: Partial<Record<Kind, string>> = {class: 'classes', interface: 'interfaces', type: 'type-aliases', function: 'functions', enum: 'enumerations'};
/** Members with these tags are not part of the API, though the type definitions keep them. */
const HIDDEN_TAGS = new Set(['internal', 'hidden', 'private']);
/** Tags without content, so that the lines after them continue the text, like `@event` on `Map#on`. */
const MODIFIER_TAGS = new Set(['event', 'experimental', 'hidden', 'internal', 'private', 'readonly', 'override', 'sealed', 'virtual']);
const MAX_HEADING = 1000;

const apis = new Map<string, Promise<Api>>();

export function registerDescribeGlJsApi(server: McpServer): void {
    server.registerTool('describe_gl_js_api', {
        title: 'Describe GL JS API',
        description: [
            'Looks up a class, method, option, event or function of MapLibre GL JS, like "Map", "Map#flyTo",',
            '"MapOptions.maxPitch", "click" or "addProtocol", in the type definitions that GL JS ships. Returns its signature,',
            'documentation, parameters, default and examples, and for a class or an options type, its members. Answers for',
            'the GL JS version this server renders with, or for another version, like the one a project uses. Check here',
            'before using a method or option you are not sure exists in MapLibre, since Mapbox GL JS has some that MapLibre',
            'GL JS does not.',
        ].join(' '),
        inputSchema: z.object({
            name: z.string().describe('The name to look up, like "Map#flyTo", "flyTo" or "MapOptions".'),
            version: z.string().optional().describe([
                'A GL JS version or range, like "5.6.0" or "5", whose type definitions are fetched from jsDelivr.',
                'Defaults to the version this server renders with.',
            ].join(' ')),
        }),
        annotations: {readOnlyHint: true, openWorldHint: true},
    }, async ({name, version}) => ({content: [{type: 'text', text: describe(await loadApi(version), name.trim())}]}));
}

/** Reads the type definitions of a GL JS version the first time they are asked for. */
function loadApi(version: string | undefined): Promise<Api> {
    const key = version ?? '';
    let api = apis.get(key);
    if (!api) {
        api = (version === undefined ? readInstalledTypes() : fetchTypes(version)).then(({source, version}) => readApi(source, version));
        apis.set(key, api);
        api.catch(() => apis.delete(key));
    }
    return api;
}

async function readInstalledTypes(): Promise<{source: string; version: string}> {
    const file = createRequire(import.meta.url).resolve('maplibre-gl/dist/maplibre-gl.d.ts');
    return {source: await readFile(file, 'utf8'), version: MAPLIBRE_VERSION};
}

/** Fetches the type definitions of a GL JS version from jsDelivr, which also resolves ranges like "5". */
async function fetchTypes(version: string): Promise<{source: string; version: string}> {
    if (!/^[\w.^~*-]+$/.test(version)) throw new Error(`"${version}" is not a version or range, like "5.6.0" or "5".`);
    const url = `https://cdn.jsdelivr.net/npm/maplibre-gl@${version}/dist/maplibre-gl.d.ts`;
    const response = await fetch(url);
    if (response.status === 404) throw new Error(`jsDelivr has no type definitions for MapLibre GL JS ${version}. Versions before 2.0 have none.`);
    if (!response.ok) throw new Error(`Fetching ${url} failed with HTTP ${response.status}.`);
    return {source: await response.text(), version: response.headers.get('x-jsd-version') ?? version};
}

function readApi(source: string, version: string): Api {
    const {body} = parse(source, {sourceType: 'module', plugins: [['typescript', {dts: true}]]}).program;
    const exported = exportedNames(body);
    const publicName = (name: string) => exported.get(name)?.[0] ?? name.replace(/\$\d+$/, '');
    const text: Text = (start, end) => tidySource(source.slice(start ?? 0, end ?? 0)).replace(/[A-Za-z_]\w*\$\d+/g, publicName);

    const local = new Map<string, Declaration>();
    for (const statement of body) {
        const node = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
        const found = node ? readDeclaration(node, docOf(statement), text) : undefined;
        if (!found) continue;
        const [name, parts] = found;
        const existing = local.get(name);
        if (existing) merge(existing, parts);
        else local.set(name, {...parts, name: publicName(name), exported: exported.has(name)});
    }

    const declarations = new Map<string, Declaration>();
    for (const [name, names] of exported) {
        const declaration = local.get(name);
        if (declaration) for (const exportedName of names) declarations.set(exportedName, declaration);
    }
    return {version, declarations, local, members: indexMembers(declarations, local)};
}

/** Returns the names GL JS exports each declaration as, by its name in the file. */
function exportedNames(body: Statement[]): Map<string, string[]> {
    const names = new Map<string, string[]>();
    const add = (name: string, exportedName: string) => names.set(name, [...names.get(name) ?? [], exportedName]);
    for (const statement of body) {
        if (statement.type !== 'ExportNamedDeclaration') continue;
        const declared = statement.declaration ? declaredName(statement.declaration) : undefined;
        if (declared) add(declared, declared);
        for (const specifier of statement.specifiers) {
            if (specifier.type === 'ExportSpecifier') add(specifier.local.name, nameOf(specifier.exported));
        }
    }
    return names;
}

function declaredName(node: Node): string | undefined {
    if (node.type === 'VariableDeclaration') {
        const id = node.declarations[0]?.id;
        return id?.type === 'Identifier' ? id.name : undefined;
    }
    return 'id' in node && node.id?.type === 'Identifier' ? node.id.name : undefined;
}

function readDeclaration(node: Node, doc: Doc, text: Text): [string, Parts] | undefined {
    switch (node.type) {
        case 'ClassDeclaration':
            if (!node.id) return undefined;
            return [node.id.name, {
                kind: 'class',
                signatures: [{text: heading(text(node.start, node.body.start)), doc}],
                members: classMembers(node.body, text),
                bases: node.superClass?.type === 'Identifier' ? [node.superClass.name] : [],
            }];
        case 'TSInterfaceDeclaration':
            return [node.id.name, {
                kind: 'interface',
                signatures: [{text: heading(text(node.start, node.body.start)), doc}],
                members: typeMembers(node.body.body, text),
                bases: (node.extends ?? []).flatMap(heritage => entityName(heritage.expression)),
            }];
        case 'TSTypeAliasDeclaration': {
            const parts = node.typeAnnotation.type === 'TSIntersectionType' ? node.typeAnnotation.types : [node.typeAnnotation];
            return [node.id.name, {
                kind: 'type',
                signatures: [{text: typeHeading(node, parts, text), doc}],
                members: parts.flatMap(part => part.type === 'TSTypeLiteral' ? typeMembers(part.members, text) : []),
                bases: parts.flatMap(part => part.type === 'TSTypeReference' ? entityName(part.typeName) : []),
            }];
        }
        case 'TSEnumDeclaration':
            return [node.id.name, {
                kind: 'enum',
                signatures: [{text: `enum ${node.id.name}`, doc}],
                members: node.members.map(member => ({
                    name: nameOf(member.id),
                    kind: 'value',
                    isStatic: true,
                    signatures: [{text: text(member.start, member.end), doc: docOf(member)}],
                })),
                bases: [],
            }];
        case 'TSDeclareFunction':
            if (!node.id) return undefined;
            return [node.id.name, {kind: 'function', signatures: [{text: heading(text(node.start, node.end)), doc}], members: [], bases: []}];
        case 'VariableDeclaration': {
            const declarator = node.declarations[0];
            if (declarator?.id.type !== 'Identifier') return undefined;
            const annotation = declarator.id.typeAnnotation;
            const type = annotation?.type === 'TSTypeAnnotation' ? annotation.typeAnnotation : undefined;
            return [declarator.id.name, {
                kind: 'variable',
                signatures: [{text: `${node.kind} ${text(declarator.start, declarator.end)}`, doc}],
                members: [],
                bases: type?.type === 'TSTypeReference' ? entityName(type.typeName) : [],
            }];
        }
        default:
            return undefined;
    }
}

function classMembers(body: ClassBody, text: Text): Member[] {
    const members: Member[] = [];
    for (const node of body.body) {
        if (node.type !== 'ClassMethod' && node.type !== 'TSDeclareMethod' && node.type !== 'ClassProperty') continue;
        if (node.computed || node.accessibility === 'private' || node.accessibility === 'protected') continue;
        const name = keyName(node.key);
        const doc = docOf(node);
        if (name === undefined || isHidden(name, doc)) continue;
        const kind = node.type === 'ClassProperty' || node.kind === 'get' || node.kind === 'set' ? 'property' : node.kind ?? 'method';
        addMember(members, {name, kind, isStatic: Boolean(node.static), signatures: [{text: text(node.start, node.end), doc}]});
    }
    return members;
}

function typeMembers(elements: TSTypeElement[], text: Text): Member[] {
    const members: Member[] = [];
    for (const node of elements) {
        if ((node.type !== 'TSPropertySignature' && node.type !== 'TSMethodSignature') || node.computed) continue;
        const name = keyName(node.key);
        const doc = docOf(node);
        if (name === undefined || isHidden(name, doc)) continue;
        const kind = node.type === 'TSMethodSignature' && node.kind === 'method' ? 'method' : 'property';
        addMember(members, {name, kind, isStatic: false, signatures: [{text: text(node.start, node.end), doc}]});
    }
    return members;
}

/** Adds a member, or another overload of one already there. */
function addMember(members: Member[], member: Member): void {
    const existing = members.find(candidate => candidate.name === member.name && candidate.isStatic === member.isStatic);
    if (existing) existing.signatures.push(...member.signatures);
    else members.push(member);
}

/** Merges another overload of a function, or another part of a merged interface, into a declaration. */
function merge(declaration: Declaration, parts: Parts): void {
    if (declaration.kind === 'function') declaration.signatures.push(...parts.signatures);
    for (const member of parts.members) addMember(declaration.members, member);
    declaration.bases.push(...parts.bases);
}

function typeHeading(node: TSTypeAliasDeclaration, parts: TSType[], text: Text): string {
    const body = parts.map(part => part.type === 'TSTypeLiteral' ? '{...}' : text(part.start, part.end)).join(' & ');
    const full = heading(`${text(node.start, node.typeAnnotation.start)} ${body}`);
    return full.length > MAX_HEADING ? `${full.slice(0, MAX_HEADING)} ...` : full;
}

function heading(text: string): string {
    return text.replace(/^(export )?(declare )?/, '');
}

function tidySource(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s+/g, ' ').trim().replace(/;$/, '');
}

function entityName(name: TSEntityName | Node): string[] {
    return name.type === 'Identifier' ? [name.name] : [];
}

function keyName(key: Node): string | undefined {
    if (key.type === 'Identifier') return key.name;
    if (key.type === 'StringLiteral') return key.value;
    if (key.type === 'NumericLiteral') return String(key.value);
    return undefined;
}

function nameOf(node: Identifier | StringLiteral): string {
    return node.type === 'Identifier' ? node.name : node.value;
}

function isHidden(name: string, doc: Doc): boolean {
    return name.startsWith('_') || doc.tags.some(tag => HIDDEN_TAGS.has(tag.name));
}

function docOf(node: Node): Doc {
    const comment = node.leadingComments?.findLast(({type, value}) => type === 'CommentBlock' && value.startsWith('*'));
    return comment ? parseDoc(comment.value) : {text: '', tags: []};
}

/**
 * Splits a documentation comment into its text and tags, and turns links and notes into plain text. A tag other than
 * `@example` ends at a blank line, and the paragraphs after it belong to the text, like the events of `Marker`.
 */
function parseDoc(comment: string): Doc {
    const text: string[] = [];
    const tags: Tag[] = [];
    let current: Tag | undefined;
    let code = false;
    let note = false;
    for (const raw of comment.slice(1).split('\n')) {
        let line = raw.replace(/^\s*\*( |$)/, '');
        if (line.trimStart().startsWith('```')) code = !code;
        const tag = code ? null : /^@(\w+)\s*(.*)$/.exec(line);
        const title = code ? null : /^!!! \w+(?: "(.*)")?\s*$/.exec(line);
        if (title) {
            line = `${title[1] ?? 'Note'}:`;
            note = true;
        } else if (note && line.startsWith('    ')) {
            line = line.slice(4);
        } else if (line.trim() !== '') {
            note = false;
        }
        if (tag && MODIFIER_TAGS.has(tag[1])) {
            tags.push({name: tag[1], text: ''});
            current = undefined;
            if (tag[2]) text.push(tag[2]);
        } else if (tag) {
            current = {name: tag[1], text: tag[2]};
            tags.push(current);
        } else if (current && current.name !== 'example' && line.trim() === '') {
            current = undefined;
            text.push(line);
        } else if (current) {
            current.text += `\n${line}`;
        } else {
            text.push(line);
        }
    }
    return {text: tidyDoc(text.join('\n')), tags: tags.map(tag => ({name: tag.name, text: tidyDoc(tag.text)}))};
}

function tidyDoc(text: string): string {
    return text
        .replace(/\{@link\s+([^}|\s]+)\s*(?:\|\s*([^}]*))?\}/g, (_, target: string, label?: string) => label?.trim() || target)
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Indexes the members of the exported declarations, each once, shown on the declaration that declares it if exported. */
function indexMembers(declarations: Map<string, Declaration>, local: Map<string, Declaration>): Map<string, Reached[]> {
    const index = new Map<string, Reached[]>();
    for (const declaration of new Set(declarations.values())) {
        for (const reached of reachableMembers(declaration, local)) {
            const list = index.get(reached.member.name) ?? [];
            if (!list.some(item => item.member === reached.member)) index.set(reached.member.name, [...list, reached]);
        }
    }
    return index;
}

/** Returns the members of a declaration and those it inherits, where its own ones win over inherited ones. */
function reachableMembers(declaration: Declaration, local: Map<string, Declaration>): Reached[] {
    const reached: Reached[] = [];
    const seen = new Set<Declaration>();
    const visit = (current: Declaration) => {
        if (seen.has(current)) return;
        seen.add(current);
        for (const member of current.members) {
            if (reached.some(item => item.member.name === member.name && item.member.isStatic === member.isStatic)) continue;
            reached.push({member, declaredIn: current, shownOn: current.exported ? current : declaration});
        }
        for (const base of current.bases) {
            const found = local.get(base);
            if (found) visit(found);
        }
    };
    visit(declaration);
    return reached;
}

function describe(api: Api, query: string): string {
    const name = query.replace(/^(maplibregl|maplibre-gl)\./, '').replace(/^new\s+/, '').replace(/\(.*\)$/s, '').replace('.prototype.', '#');
    const qualified = /^([\w$]+)[#.]([\w$]+)$/.exec(name);
    if (qualified) return describeQualified(api, qualified[1], qualified[2]);

    const declaration = api.declarations.get(name);
    if (declaration) return describeDeclaration(api, declaration);
    const members = api.members.get(name);
    if (members) return describeMembers(api, name, members);
    const anyCase = findIgnoringCase(api.declarations, name);
    if (anyCase) return describeDeclaration(api, anyCase);
    const membersAnyCase = [...api.members].filter(([candidate]) => sameName(candidate, name)).flatMap(([, list]) => list);
    if (membersAnyCase.length > 0) return describeMembers(api, name, membersAnyCase);
    return unknown(api, name);
}

function describeQualified(api: Api, ownerName: string, memberName: string): string {
    const owner = api.declarations.get(ownerName) ?? findIgnoringCase(api.declarations, ownerName);
    if (!owner) return unknown(api, ownerName);
    const members = reachableMembers(owner, api.local);
    const found = members.find(({member}) => member.name === memberName) ?? members.find(({member}) => sameName(member.name, memberName));
    if (found) return describeMember(api, {...found, shownOn: owner});
    const suggestions = suggestNames(memberName, members.map(({member}) => member.name));
    const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
    return `${owner.name} has no member "${memberName}" in MapLibre GL JS ${api.version}.${hint}`;
}

function describeDeclaration(api: Api, declaration: Declaration): string {
    const lines = [`${declaration.name} (${declaration.kind}, MapLibre GL JS ${api.version})`];
    lines.push(...signatureLines(api, declaration.signatures));
    if (declaration.kind === 'class') lines.push(...classLines(api, declaration));
    else if (declaration.kind === 'enum') lines.push('Values:', ...declaration.members.map(member => memberLine(api, member)));
    else lines.push(...typeLines(api, declaration));
    const url = docsUrl(declaration);
    if (url) lines.push(`Docs: ${url}`);
    return lines.join('\n');
}

/** Lists the constructor and the members of a class, by name, since a class can have a hundred of them. */
function classLines(api: Api, declaration: Declaration): string[] {
    const reached = reachableMembers(declaration, api.local);
    const own = reached.filter(({declaredIn}) => declaredIn === declaration).map(({member}) => member);
    const lines: string[] = [];
    const constructor = reached.find(({member}) => member.kind === 'constructor')?.member;
    if (constructor) lines.push('Constructor:', ...constructor.signatures.map(({text}) => `  ${text.replace(/^constructor/, `new ${declaration.name}`)}`));
    const groups: [string, Member[]][] = [
        ['Methods', own.filter(member => member.kind === 'method' && !member.isStatic)],
        ['Properties', own.filter(member => member.kind === 'property' && !member.isStatic)],
        ['Static members', own.filter(member => member.isStatic)],
    ];
    for (const [label, members] of groups) {
        if (members.length > 0) lines.push(`${label}: ${members.map(member => member.name).join(', ')}.`);
    }
    return [...lines, ...inheritedLines(reached, declaration)];
}

/** Lists the properties and methods of an interface or a type with their types, since those are the options to pass. */
function typeLines(api: Api, declaration: Declaration): string[] {
    const reached = reachableMembers(declaration, api.local);
    const own = reached.filter(({declaredIn}) => declaredIn === declaration).map(({member}) => member);
    const properties = own.filter(member => member.kind !== 'method');
    const methods = own.filter(member => member.kind === 'method');
    return [
        ...properties.length > 0 ? ['Properties:', ...properties.map(member => memberLine(api, member))] : [],
        ...methods.length > 0 ? ['Methods:', ...methods.map(member => memberLine(api, member))] : [],
        ...inheritedLines(reached, declaration),
    ];
}

function inheritedLines(reached: Reached[], declaration: Declaration): string[] {
    const byBase = new Map<Declaration, string[]>();
    for (const {member, declaredIn} of reached) {
        if (declaredIn === declaration || member.kind === 'constructor') continue;
        byBase.set(declaredIn, [...byBase.get(declaredIn) ?? [], member.name]);
    }
    return [...byBase].map(([base, names]) => `From ${base.name}: ${names.join(', ')}.`);
}

function memberLine(api: Api, member: Member): string {
    const [{text, doc}] = member.signatures;
    const resolved = inheritedDoc(api, doc) ?? doc;
    const fallback = resolved.tags.find(tag => tag.name === 'defaultValue');
    const sentence = firstSentence(resolved.text);
    return `  ${text}${fallback ? ` (default ${flat(fallback.text)})` : ''}${sentence ? `. ${sentence}` : ''}`;
}

/** Describes the one member with a name, or lists them all, documented ones first and those of bigger declarations first. */
function describeMembers(api: Api, name: string, members: Reached[]): string {
    if (members.length === 1) return describeMember(api, members[0]);
    const listed = members.map(reached => {
        const doc = reached.member.signatures[0].doc;
        return {reached, sentence: firstSentence((inheritedDoc(api, doc) ?? doc).text)};
    });
    listed.sort((a, b) => Number(Boolean(b.sentence)) - Number(Boolean(a.sentence)) || b.reached.shownOn.members.length - a.reached.shownOn.members.length);
    return [
        `"${name}" names ${members.length} members in MapLibre GL JS ${api.version}. Look one up for the details:`,
        ...listed.map(({reached, sentence}) => `  ${memberTitle(reached.shownOn, reached.member)}${sentence ? `: ${sentence}` : ''}`),
    ].join('\n');
}

function describeMember(api: Api, {member, declaredIn, shownOn}: Reached): string {
    const from = declaredIn === shownOn ? '' : `, from ${declaredIn.name}`;
    const lines = [`${memberTitle(shownOn, member)} (${member.kind} of ${shownOn.name}${from}, MapLibre GL JS ${api.version})`];
    lines.push(...signatureLines(api, member.signatures));
    const url = docsUrl(declaredIn.exported ? declaredIn : shownOn, member.name);
    if (url) lines.push(`Docs: ${url}`);
    return lines.join('\n');
}

/** Writes each overload with its documentation, which overloads that share it get once. */
function signatureLines(api: Api, signatures: Signature[]): string[] {
    const lines: string[] = [];
    signatures.forEach(({text, doc}, index) => {
        if (index > 0) lines.push('');
        lines.push(text);
        if (index === 0 || doc !== signatures[index - 1].doc) lines.push(...docLines(api, doc));
    });
    return lines;
}

function docLines(api: Api, doc: Doc): string[] {
    const {text, tags} = inheritedDoc(api, doc) ?? doc;
    const lines: string[] = [];
    for (const tag of tags.filter(({name}) => name === 'deprecated')) lines.push(tag.text ? `Deprecated: ${flat(tag.text)}` : 'Deprecated.');
    if (tags.some(({name}) => name === 'experimental')) lines.push('Experimental.');
    if (tags.some(({name}) => name === 'internal')) lines.push('Internal, so not part of the documented API.');
    if (text) lines.push(text);
    const params = tags.filter(({name}) => name === 'param');
    if (params.length > 0) lines.push('Parameters:', ...params.map(({text}) => `  ${parameterLine(text)}`));
    for (const tag of tags) {
        const content = flat(tag.name === 'returns' || tag.name === 'return' ? withoutType(tag.text) : tag.text);
        if (!content) continue;
        if (tag.name === 'returns' || tag.name === 'return') lines.push(`Returns: ${content}`);
        if (tag.name === 'throws') lines.push(`Throws: ${content}`);
        if (tag.name === 'defaultValue') lines.push(`Default: ${content}`);
        if (tag.name === 'example') lines.push('Example:', tag.text);
        if (tag.name === 'see') lines.push(`See: ${content}`);
    }
    return lines;
}

/** Writes a `@param`, also in the JSDoc style of GL JS 2, like `{number} [options.curve=1.42] The curve`. */
function parameterLine(text: string): string {
    const [, name, description] = /^(\S+)\s*(?:-\s*)?([\s\S]*)$/.exec(withoutType(text)) ?? [text, text, ''];
    const optional = /^\[([^=\]]+)(?:=([^\]]*))?\]$/.exec(name);
    const label = optional ? `${optional[1]} (optional${optional[2] ? `, default ${optional[2]}` : ''})` : name;
    return description ? `${label}: ${flat(description)}` : label;
}

function withoutType(text: string): string {
    return text.replace(/^\{[^}]*\}\s*/, '');
}

/** Resolves a comment that is only `{@inheritDoc Owner.member}` to the documentation it points to. */
function inheritedDoc(api: Api, doc: Doc): Doc | undefined {
    const match = /^\{@inheritDoc ([\w$]+)[.#]([\w$]+)\}$/.exec(doc.text);
    if (!match) return undefined;
    const owner = api.declarations.get(match[1]) ?? api.local.get(match[1]);
    return owner?.members.find(member => member.name === match[2])?.signatures[0].doc;
}

function unknown(api: Api, name: string): string {
    const suggestions = suggestNames(name, [...new Set([...api.declarations.keys(), ...api.members.keys()])]);
    const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
    return `"${name}" is not in MapLibre GL JS ${api.version}.${hint}`;
}

function memberTitle(owner: Declaration, member: Member): string {
    return `${owner.name}${owner.kind === 'class' && !member.isStatic ? '#' : '.'}${member.name}`;
}

function docsUrl(declaration: Declaration, member?: string): string | undefined {
    const folder = DOCS_FOLDERS[declaration.kind];
    if (!folder || !declaration.exported) return undefined;
    return `${DOCS}${folder}/${declaration.name}/${member ? `#${member.toLowerCase()}` : ''}`;
}

function findIgnoringCase(declarations: Map<string, Declaration>, name: string): Declaration | undefined {
    return [...declarations].find(([candidate]) => sameName(candidate, name))?.[1];
}

function sameName(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

function firstSentence(text: string): string {
    const line = flat(text);
    const end = line.search(/\.(\s|$)/);
    return end === -1 ? line : line.slice(0, end + 1);
}

function flat(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}
