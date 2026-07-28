import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        exclude: [...configDefaults.exclude, '.direnv/**', 'e2e/**', 'blog/quartz/**', 'worktree/**'],
    },
});
