// @ts-check
import { cfgFlags, lsStackEslintCfg } from '@ls-stack/eslint-cfg';

const { OFF } = cfgFlags;

export default lsStackEslintCfg({
  tsconfigRootDir: import.meta.dirname,
  globalRules: {
    '@typescript-eslint/no-explicit-any': OFF,
    '@typescript-eslint/no-unsafe-assignment': OFF,
  },
  extraRuleGroups: [
    {
      files: ['tests/**/*.test.{ts,tsx}'],
      rules: {
        '@typescript-eslint/consistent-type-assertions': OFF,
        '@typescript-eslint/no-non-null-assertion': OFF,
        '@typescript-eslint/no-unsafe-member-access': OFF,
      },
    },
  ],
});
