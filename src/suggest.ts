/** Returns the candidates within a few typos of a name that was not found, closest first, then those that contain it. */
export function suggestNames(name: string, candidates: string[]): string[] {
    const wanted = name.toLowerCase();
    const containing = candidates.filter(candidate => candidate !== name && candidate.toLowerCase().includes(wanted)).slice(0, 20);
    const close = candidates
        .map(candidate => ({candidate, distance: editDistance(wanted, candidate.toLowerCase())}))
        .filter(({distance}) => distance <= Math.max(1, Math.floor(name.length / 4)))
        .sort((a, b) => a.distance - b.distance)
        .map(({candidate}) => candidate)
        .slice(0, 5);
    return [...new Set([...close, ...containing])];
}

function editDistance(a: string, b: string): number {
    let previous = Array.from({length: b.length + 1}, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++) {
            const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
            current.push(Math.min(previous[j] + 1, current[j - 1] + 1, substitution));
        }
        previous = current;
    }
    return previous[b.length];
}
