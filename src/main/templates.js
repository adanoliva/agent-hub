/**
 * templates.js — CLAUDE.md templates per category + technology
 * Used when creating a new project.
 */

const TEMPLATES = {

  'games-unity': (name) => `# ${name}

## Stack
- Unity 2023 LTS, Universal Render Pipeline (URP)
- C# (.NET Standard 2.1), Cinemachine, Input System, TextMeshPro

## Project structure
\`\`\`
Assets/
├── Scripts/
│   ├── Core/          # GameManager, EventBus, ServiceLocator
│   ├── Player/        # Player controller and mechanics
│   ├── Enemies/       # AI and behaviors (IEnemy interface)
│   ├── UI/            # UI controllers
│   └── Data/          # ScriptableObject definitions
├── Prefabs/
├── Scenes/
├── ScriptableObjects/
└── Art/
\`\`\`

## Code conventions
- Use \`[SerializeField]\` instead of public fields
- Cache component references in \`Awake()\`, never in \`Update()\`
- MonoBehaviours are thin controllers — delegate logic to plain C# classes
- Use C# events/Actions for inter-system communication
- Never use \`FindObjectOfType()\` at runtime

## Rules
- Do not modify \`Assets/Plugins/\` or \`Assets/ThirdParty/\`
- Run Test Runner (Window > Test Runner) before every commit
- All prefabs must have a matching ScriptableObject data asset
`,

  'games-godot': (name) => `# ${name}

## Stack
- Godot 4.x, GDScript (typed) / C#

## Project structure
\`\`\`
scenes/      # .tscn scene files
scripts/     # GDScript / C# logic
resources/   # Custom Resource classes and data
assets/      # Sprites, audio, fonts
addons/      # Plugins (do not edit manually)
\`\`\`

## Code conventions
- Type hints everywhere: \`var health: int = 100\`
- \`@export\` for designer-configurable values
- \`@onready\` for node references
- Signals for upward communication — never direct parent references
- Autoloads only for true globals (GameManager, AudioBus)

## Rules
- Do not edit files inside \`addons/\`
- Follow official GDScript style guide (4-space indent, snake_case)
`,

  'web-react': (name) => `# ${name}

## Stack
- React 18, Vite 5, TypeScript (strict), TailwindCSS
- React Query (data fetching), Zustand (state), React Router v6

## Project structure
\`\`\`
src/
├── components/    # Reusable UI components
├── pages/         # Route-level views
├── hooks/         # Custom hooks (business logic)
├── stores/        # Zustand stores
├── services/      # API calls and external integrations
└── types/         # TypeScript type definitions
\`\`\`

## Conventions
- Mobile-first responsive design
- TypeScript strict mode — no \`any\` types
- React Query for all data fetching — no manual useEffect for fetch
- Custom hooks for logic — not inline in components
- Component files: PascalCase.tsx, hook files: useCamelCase.ts

## Rules
- \`npm test\` must pass before every PR
- No direct DOM manipulation
- All API calls go through \`src/services/\`
`,

  'web-fullstack': (name) => `# ${name}

## Stack
- Frontend: React 18, Vite, TypeScript, TailwindCSS
- Backend: Node.js 20+, Express 5, TypeScript
- Database: PostgreSQL + Prisma ORM
- Auth: JWT | Validation: Zod

## Project structure
\`\`\`
apps/
├── web/           # React frontend
└── api/           # Express backend
    ├── routes/    # HTTP handlers
    ├── services/  # Business logic
    └── repos/     # Data access
packages/
└── shared/        # Shared TypeScript types
\`\`\`

## Conventions
- camelCase for variables, PascalCase for types/interfaces
- Zod validation on all API inputs before reaching services
- Prisma migrations only — never ALTER TABLE manually
- \`.env.local\` for environment variables — never commit secrets

## Rules
- Every endpoint needs an integration test
- No business logic in route handlers
- Database transactions for multi-step operations
`,

  'web-nextjs': (name) => `# ${name}

## Stack
- Next.js 14 (App Router), React 18, TypeScript (strict)
- TailwindCSS, Prisma + PostgreSQL, NextAuth.js

## Project structure
\`\`\`
app/
├── (auth)/        # Auth routes
├── (dashboard)/   # Protected routes
└── api/           # API route handlers
components/        # Shared components
lib/               # Prisma client, auth config, utilities
\`\`\`

## Conventions
- Server Components by default — \`'use client'\` only when necessary
- Server Actions for all data mutations
- \`next/image\` for all images — never raw \`<img>\`
- Metadata export in every \`page.tsx\`

## Rules
- Never pass non-serializable props from Server to Client components
- All database access through Prisma — no raw SQL unless profiling requires it
`,

  'mobile-react-native': (name) => `# ${name}

## Stack
- React Native 0.73+, Expo SDK 50+, TypeScript
- Expo Router, React Query, Zustand, NativeWind

## Project structure
\`\`\`
app/           # Screens (Expo Router file-based)
components/    # Reusable components
hooks/         # Custom hooks
services/      # API calls
assets/        # Images, fonts, icons
\`\`\`

## Conventions
- Never use fixed pixel dimensions — flex and percentages only
- Always handle safe areas with \`useSafeAreaInsets()\`
- FlatList for all lists — never ScrollView + map
- Reanimated 3 for animations
- Test on both iOS and Android before every PR

## Rules
- \`Platform.select()\` for platform-specific code, not inline OS checks
- All network calls through \`src/services/\`
`,

  'mobile-pwa': (name) => `# ${name}

## Stack
- React 18, Vite, TypeScript, TailwindCSS
- Vite PWA Plugin, Workbox (offline cache)

## Project structure
\`\`\`
src/
├── components/
├── pages/
└── hooks/
public/
├── manifest.json    # PWA manifest
└── icons/           # Icons at all required sizes
\`\`\`

## PWA requirements
- Lighthouse score: minimum 90 in PWA, Performance, Accessibility
- Mobile-first, touch targets minimum 44px
- Offline fallback page required
- App manifest: name, icons (192px, 512px), display: standalone

## Rules
- All images via Vite PWA plugin asset pipeline
- Service worker managed by Workbox — do not edit manually
`,

  'docs': (name) => `# ${name}

## Stack
- Markdown / MDX, Docusaurus 3 (or VitePress), Mermaid diagrams

## Document structure
\`\`\`
docs/
├── guides/        # Step-by-step guides
├── api/           # API reference
├── tutorials/     # Tutorials with outcomes
└── changelog/     # Version history
\`\`\`

## Writing conventions
- Second person: "Install the package" not "The user installs"
- Active voice, short sentences
- Every page: intro (what you'll learn) + content + next steps
- Code examples must be real and runnable
- Mermaid diagrams for architecture and flows

## Rules
- Test all code examples before publishing
- No assumed knowledge without a link to explanation
- Consistent terminology: define terms on first use
`,
};

/**
 * Returns the CLAUDE.md template for a given category/tech combination.
 * Falls back to a generic template if no specific one exists.
 */
function getTemplate(categoryId, techId, projectName) {
  const key = techId ? `${categoryId}-${techId}` : categoryId;
  const fn  = TEMPLATES[key];
  if (fn) return fn(projectName);

  // Generic fallback
  return `# ${projectName}

## Stack
<!-- Document your stack here -->

## Project structure
\`\`\`
<!-- Describe your folder structure -->
\`\`\`

## Conventions
<!-- Document your coding conventions -->

## Rules
<!-- Document project-specific rules for Claude Code -->
`;
}

module.exports = { getTemplate, TEMPLATES };
