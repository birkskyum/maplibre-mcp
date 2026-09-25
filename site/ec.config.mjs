import {defineEcConfig} from '@astrojs/starlight/expressive-code';

/** Code blocks without window frames, on the same slate as the rest of the site. Lives here because astro.config.mjs cannot pass functions on. */
export default defineEcConfig({
    defaultProps: {wrap: true, frame: 'none'},
    styleOverrides: {
        borderRadius: '0.5rem',
        borderWidth: '0px',
        codeBackground: ({theme}) => (theme.type === 'dark' ? '#0f172a' : '#f8fafc'),
    },
});
