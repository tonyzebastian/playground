import base from '../../eslint.config.mjs';

// The repository's default config doesn't enumerate JSX files.
const config=[...base,{
  files:['**/*.jsx','**/*.js','**/*.mjs'],
  languageOptions:{parserOptions:{ecmaFeatures:{jsx:true}}},
}];
export default config;
