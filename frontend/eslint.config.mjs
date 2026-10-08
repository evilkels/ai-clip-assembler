import eslint from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'out/**', 'playwright-report/**', 'test-results/**', '.tmp/**']
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      'react-hooks/immutability': 'error',
      'react-hooks/refs': 'error',
      'react-hooks/set-state-in-effect': 'error'
    }
  },
  {
    files: ['src/renderer/src/components/Timeline.tsx'],
    rules: {
      'react-hooks/immutability': 'off'
    }
  },
  {
    files: [
      'src/renderer/src/components/ReviewChatPanel.tsx',
      'src/renderer/src/components/Timeline.tsx',
      'src/renderer/src/components/useSequencePlayer.ts'
    ],
    rules: {
      'react-hooks/refs': 'off'
    }
  },
  {
    files: [
      'src/renderer/src/components/ClipGenerationPanel.tsx',
      'src/renderer/src/components/ConnectionsTabPanel.tsx',
      'src/renderer/src/components/DiagnosticsTabPanel.tsx',
      'src/renderer/src/components/Timeline.tsx',
      'src/renderer/src/components/UpdateSection.tsx',
      'src/renderer/src/components/useSequencePlayer.ts',
      'src/renderer/src/hooks/useReviewConversation.ts',
      'src/renderer/src/routes/PlaywriterQa.tsx',
      'src/renderer/src/routes/Timeline.tsx',
      'src/renderer/src/state/ReviewContext.tsx'
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'off'
    }
  }
)
