// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from 'eslint-plugin-storybook';

import eslintConfigAngular from '@epam/eslint-config-angular';

export default [
  {
    ignores: [
      '*.config.ts',
      'setup-jest.ts',
      '.storybook/',
      'src/stories/',
      'dist',
      'node_modules',
      '.angular',
      '.claude/worktrees',
    ],
  },
  ...eslintConfigAngular,
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
    },
  },
  ...storybook.configs['flat/recommended'],
];
