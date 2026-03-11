import main from '@switz/eslint-config';
import react from '@switz/eslint-config/react.mjs';

export default [
  { ignores: ['**/.timber/**'] },
  ...main,
  ...react,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
];
