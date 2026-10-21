// #1546: React Native 0.88 serves `AssetRegistry` from its private
// src/private/assets module, while jest-expo mocks only the
// `react-native/asset-registry` entry point that its asset transformer
// registers against. expo-asset (and so expo-font / @expo/vector-icons) reads
// the private registry, finds nothing, and throws "missing from the asset
// registry". Route the private registry through the mocked entry point so both
// sides see the same assets.
const path = require('path');

const privateRegistry = path.join(
  path.dirname(require.resolve('react-native/package.json')),
  'src/private/assets/AssetRegistry',
);

jest.doMock(privateRegistry, () => {
  const registry = () => require('react-native/asset-registry');
  return {
    AssetRegistry: {
      registerAsset: (asset) => registry().registerAsset(asset),
      getAssetByID: (assetId) => registry().getAssetByID(assetId),
    },
  };
});
