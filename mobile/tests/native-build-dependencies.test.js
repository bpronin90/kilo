const { createRequire } = require('node:module');

describe('native build dependency compatibility', () => {
  it('lets React Native Codegen expand brace globs', () => {
    const requireFromCodegen = createRequire(require.resolve('@react-native/codegen/package.json'));
    const glob = requireFromCodegen('glob');

    expect(() => glob.sync('*.{js,ts}', { cwd: __dirname })).not.toThrow();
  });
});
