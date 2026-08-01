/**
 * Setup GitHub Projects Board for Case Explorer
 * This script provides the API calls and instructions to set up the 90-day roadmap board
 * 
 * USAGE:
 * 1. Create a personal access token with repo and project permissions
 * 2. Set GITHUB_TOKEN environment variable
 * 3. Run: node scripts/setup_github_projects.js
 * 
 * OR use the GitHub UI manually with the provided configuration
 */

const PROJECT_CONFIG = {
  name: 'Case Explorer: 90-Day Roadmap',
  owner: 'emkwambe',
  repo: 'case-explorer',
  description: '90-day development roadmap for the Case Explorer synthetic underwriting data platform',
  
  // Columns configuration
  columns: [
    { name: '📝 To Do', color: '#FBFEF9' },
    { name: '👨‍💻 In Progress', color: '#E9F5FB' },
    { name: '👀 In Review', color: '#FEF2E6' },
    { name: '✅ Done', color: '#E6FBF4' },
    { name: '❌ Blocked', color: '#FFE1E4' }
  ],
  
  // Milestones (sprints)
  milestones: [
    {
      title: 'Sprint 0: Foundation',
      description: 'Establish infrastructure for the 90-day roadmap with CI/CD, database, and documentation.',
      due_on: '2026-08-14T23:59:59Z',
      state: 'open'
    },
    {
      title: 'Sprint 1: API & Core',
      description: 'Build REST API with authentication and core case generation endpoints.',
      due_on: '2026-08-28T23:59:59Z',
      state: 'open'
    },
    {
      title: 'Sprint 2: Scalability',
      description: 'Add database persistence, worker threads, and performance optimizations.',
      due_on: '2026-09-11T23:59:59Z',
      state: 'open'
    },
    {
      title: 'Sprint 3: Productization',
      description: 'Migrate to TypeScript, modularize codebase, add unit tests, and improve UI.',
      due_on: '2026-09-25T23:59:59Z',
      state: 'open'
    },
    {
      title: 'Sprint 4: Advanced Features',
      description: 'Add multi-loan type support, visualization, custom fraud patterns, and deploy to production.',
      due_on: '2026-10-09T23:59:59Z',
      state: 'open'
    }
  ],
  
  // Labels to create
  labels: [
    { name: 'frontend', color: '1d76db', description: 'React/UI tasks' },
    { name: 'backend', color: '0075ca', description: 'Node.js/API tasks' },
    { name: 'database', color: '009800', description: 'Database-related tasks' },
    { name: 'devops', color: '8957e5', description: 'Infrastructure, CI/CD' },
    { name: 'documentation', color: '1d76db', description: 'Docs and guides' },
    { name: 'bug', color: 'd73a49', description: 'Bug fixes' },
    { name: 'enhancement', color: '0075ca', description: 'New features' },
    { name: 'priority:high', color: 'd73a49', description: 'High priority' },
    { name: 'priority:medium', color: 'fbcbeb', description: 'Medium priority' },
    { name: 'priority:low', color: 'c2e0c6', description: 'Low priority' },
    { name: 'epic:sprint-0', color: 'fef2c0', description: 'Sprint 0 epic' },
    { name: 'epic:sprint-1', color: 'fef2c0', description: 'Sprint 1 epic' },
    { name: 'epic:sprint-2', color: 'fef2c0', description: 'Sprint 2 epic' },
    { name: 'epic:sprint-3', color: 'fef2c0', description: 'Sprint 3 epic' },
    { name: 'epic:sprint-4', color: 'fef2c0', description: 'Sprint 4 epic' }
  ],
  
  // All issues organized by sprint
  issues: {
    'Sprint 0': [
      {
        title: 'Set up GitHub Projects board with columns and milestones',
        body: `## Task
Create the "Case Explorer: 90-Day Roadmap" GitHub Projects board with:
- Columns: To Do, In Progress, In Review, Done, Blocked
- Milestones: Sprint 0-4
- Add all issues from this document to the board
- Configure automation rules

## Acceptance Criteria
- [ ] Projects board exists with correct name
- [ ] All 5 columns are configured
- [ ] All 5 milestones are created
- [ ] All Sprint 0 issues are added to the board
- [ ] Automation rules are configured

## Labels
\`devops\`, \`priority:high\`, \`epic:sprint-0\`

## Estimate
2 hours`,
        labels: ['devops', 'priority:high', 'epic:sprint-0'],
        assignee: null
      },
      {
        title: 'Set up CI/CD pipeline with GitHub Actions',
        body: `## Task
Create GitHub Actions workflows to automate:
- Running tests on pull requests (lint, validate)
- Running tests on pushes to main
- Building and deploying the static site
- Automating release process

## Acceptance Criteria
- [ ] \`.github/workflows/ci.yml\` exists
- [ ] Workflow runs on PR to \`main\` branch
- [ ] Workflow runs \`npm run lint\` successfully
- [ ] Workflow runs \`npm run validate\` successfully
- [ ] Workflow runs \`npm run build\` successfully
- [ ] Workflow fails and blocks merge if tests fail

## Labels
\`devops\`, \`backend\`, \`priority:high\`, \`epic:sprint-0\`

## Estimate
4 hours`,
        labels: ['devops', 'backend', 'priority:high', 'epic:sprint-0'],
        assignee: null
      },
      {
        title: 'Configure PostgreSQL database (local + cloud)',
        body: `## Task
Set up PostgreSQL database for development and production:
- Local PostgreSQL setup instructions
- Cloud database on Supabase or Neon.tech
- Connection string management (environment variables)
- Basic schema for cases, users, configurations

## Acceptance Criteria
- [ ] \`docs/DB_SETUP.md\` created with setup instructions
- [ ] Local PostgreSQL connection works
- [ ] Cloud PostgreSQL instance created and configured
- [ ] \`.env.example\` contains all required DB variables
- [ ] Basic schema SQL file created (\`docs/db/schema.sql\`)

## Labels
\`database\`, \`backend\`, \`devops\`, \`priority:high\`, \`epic:sprint-0\`

## Estimate
6 hours`,
        labels: ['database', 'backend', 'devops', 'priority:high', 'epic:sprint-0'],
        assignee: null
      },
      {
        title: 'Create PROJECT.md with 90-day roadmap overview',
        body: `## Task
Create a comprehensive \`PROJECT.md\` file at the repo root that includes:
- Project vision and goals
- 90-day roadmap with sprint summaries
- Sprint objectives
- Team roles and responsibilities
- Links to resources (board, docs, Slack)

## Acceptance Criteria
- [ ] \`PROJECT.md\` exists at repo root
- [ ] Contains project vision and goals
- [ ] Contains 90-day roadmap with sprint summaries
- [ ] Contains team contact information
- [ ] Links to GitHub Projects board

## Labels
\`documentation\`, \`priority:high\`, \`epic:sprint-0\`

## Estimate
2 hours`,
        labels: ['documentation', 'priority:high', 'epic:sprint-0'],
        assignee: null
      },
      {
        title: 'Document current architecture with Mermaid diagrams',
        body: `## Task
Create \`docs/ARCHITECTURE.md\` with:
- High-level system architecture diagram (Mermaid.js)
- Component descriptions
- Data flow explanations
- Technology stack overview
- Deployment architecture

## Acceptance Criteria
- [ ] \`docs/ARCHITECTURE.md\` exists
- [ ] Contains at least 2 Mermaid diagrams
- [ ] Describes all major components
- [ ] Explains data flow
- [ ] Lists technology stack

## Labels
\`documentation\`, \`priority:high\`, \`epic:sprint-0\`

## Estimate
4 hours`,
        labels: ['documentation', 'priority:high', 'epic:sprint-0'],
        assignee: null
      },
      {
        title: 'Create #case-explorer Slack channel for team communication',
        body: `## Task
Set up team communication infrastructure:
- Create Slack channel #case-explorer
- Invite all team members
- Set up channel purpose and guidelines
- Integrate GitHub notifications

## Acceptance Criteria
- [ ] Slack channel #case-explorer exists
- [ ] All team members are invited
- [ ] Channel purpose is set
- [ ] GitHub integration is configured

## Labels
\`devops\`, \`priority:medium\`, \`epic:sprint-0\`

## Estimate
1 hour`,
        labels: ['devops', 'priority:medium', 'epic:sprint-0'],
        assignee: null
      },
      {
        title: 'Create GitHub issue and PR templates',
        body: `## Task
Create standardized templates for:
- Bug reports
- Feature requests
- Pull requests
- Documentation requests

## Acceptance Criteria
- [ ] \`.github/ISSUE_TEMPLATE/bug_report.md\` exists
- [ ] \`.github/ISSUE_TEMPLATE/feature_request.md\` exists
- [ ] \`.github/pull_request_template.md\` exists
- [ ] Templates include all required fields

## Labels
\`devops\`, \`documentation\`, \`priority:medium\`, \`epic:sprint-0\`

## Estimate
2 hours`,
        labels: ['devops', 'documentation', 'priority:medium', 'epic:sprint-0'],
        assignee: null
      }
    ],
    
    'Sprint 1': [
      {
        title: 'Design REST API specification',
        body: `## Task
Design the API specification using OpenAPI/Swagger:
- Endpoints for case generation
- Endpoints for batch generation
- Authentication endpoints
- Rate limiting strategy
- Error handling standards

## Acceptance Criteria
- [ ] \`docs/api/openapi.yaml\` or \`openapi.json\` exists
- [ ] All major endpoints are defined
- [ ] Request/response schemas are documented
- [ ] Authentication flow is documented
- [ ] Reviewed by team

## Labels
\`backend\`, \`documentation\`, \`priority:high\`, \`epic:sprint-1\`

## Estimate
4 hours`,
        labels: ['backend', 'documentation', 'priority:high', 'epic:sprint-1'],
        assignee: null
      },
      {
        title: 'Implement Express.js API server for case generation',
        body: `## Task
Create a Node.js/Express server that:
- Exposes REST endpoints from the API spec
- Integrates with the existing generator.js
- Handles request validation
- Returns proper HTTP status codes

## Acceptance Criteria
- [ ] \`src/server.js\` or \`src/api/index.js\` exists
- [ ] \`/api/health\` endpoint works
- [ ] \`/api/cases/generate\` endpoint works
- [ ] \`/api/cases/batch\` endpoint works
- [ ] Request validation implemented
- [ ] Error handling implemented

## Labels
\`backend\`, \`priority:high\`, \`epic:sprint-1\`

## Estimate
8 hours`,
        labels: ['backend', 'priority:high', 'epic:sprint-1'],
        assignee: null
      },
      {
        title: 'Implement API key authentication for endpoints',
        body: `## Task
Implement authentication using API keys:
- Generate API keys for users
- Validate API keys on protected endpoints
- Store API keys securely
- Rate limit by API key

## Acceptance Criteria
- [ ] API key generation endpoint works
- [ ] Protected endpoints require valid API key
- [ ] Rate limiting works (e.g., 1000 reqs/hour free tier)
- [ ] API keys stored securely (hashed)
- [ ] Invalid key returns 401 Unauthorized

## Labels
\`backend\`, \`devops\`, \`priority:high\`, \`epic:sprint-1\`

## Estimate
6 hours`,
        labels: ['backend', 'devops', 'priority:high', 'epic:sprint-1'],
        assignee: null
      },
      {
        title: 'Deploy API documentation using Swagger UI or Redoc',
        body: `## Task
Deploy interactive API documentation:
- Use Swagger UI or Redoc
- Host on GitHub Pages or Vercel
- Keep in sync with OpenAPI spec

## Acceptance Criteria
- [ ] API docs site is deployed and accessible
- [ ] All endpoints are documented
- [ ] Try-it-out functionality works
- [ ] Links from README and main site

## Labels
\`backend\`, \`documentation\`, \`priority:medium\`, \`epic:sprint-1\`

## Estimate
2 hours`,
        labels: ['backend', 'documentation', 'priority:medium', 'epic:sprint-1'],
        assignee: null
      },
      {
        title: 'Add input validation middleware for API endpoints',
        body: `## Task
Add validation for all API inputs:
- Use Joi or Zod for schema validation
- Validate query parameters
- Validate request bodies
- Return clear error messages

## Acceptance Criteria
- [ ] Validation middleware implemented
- [ ] All endpoints have input validation
- [ ] Invalid input returns 400 with clear message
- [ ] Validation schemas are tested

## Labels
\`backend\`, \`priority:medium\`, \`epic:sprint-1\`

## Estimate
4 hours`,
        labels: ['backend', 'priority:medium', 'epic:sprint-1'],
        assignee: null
      },
      {
        title: 'Add unit tests for API endpoints',
        body: `## Task
Add comprehensive tests for API:
- Test all endpoints (health, generate, batch)
- Test authentication
- Test validation
- Test error handling

## Acceptance Criteria
- [ ] Tests exist for all API endpoints
- [ ] Tests pass locally
- [ ] Tests run in CI/CD
- [ ] Coverage >80% for API code

## Labels
\`backend\`, \`priority:medium\`, \`epic:sprint-1\`

## Estimate
4 hours`,
        labels: ['backend', 'priority:medium', 'epic:sprint-1'],
        assignee: null
      }
    ],
    
    'Sprint 2': [
      {
        title: 'Integrate PostgreSQL database for case persistence',
        body: `## Task
Connect the generator to PostgreSQL:
- Store generated cases in database
- Add metadata (timestamp, user, seed)
- Implement query endpoints for cases
- Add pagination for case listings

## Acceptance Criteria
- [ ] Cases are stored in PostgreSQL
- [ ] \`/api/cases\` endpoint returns paginated list
- [ ] \`/api/cases/{id}\` endpoint returns single case
- [ ] Database schema is versioned
- [ ] Migrations are documented

## Labels
\`backend\`, \`database\`, \`priority:high\`, \`epic:sprint-2\`

## Estimate
8 hours`,
        labels: ['backend', 'database', 'priority:high', 'epic:sprint-2'],
        assignee: null
      },
      {
        title: 'Implement worker threads for parallel case generation',
        body: `## Task
Improve batch generation performance:
- Use Node.js worker_threads module
- Parallelize case generation
- Implement progress reporting
- Handle errors gracefully

## Acceptance Criteria
- [ ] Worker thread implementation exists
- [ ] Batch generation uses multiple threads
- [ ] Progress is reported during batch
- [ ] 10K cases generate in < 60 seconds
- [ ] Error handling works across threads

## Labels
\`backend\`, \`priority:high\`, \`epic:sprint-2\`

## Estimate
6 hours`,
        labels: ['backend', 'priority:high', 'epic:sprint-2'],
        assignee: null
      },
      {
        title: 'Add Redis caching for frequent queries',
        body: `## Task
Add Redis caching for:
- Frequently accessed cases
- Configuration lookups
- Rate limit tracking
- Common queries

## Acceptance Criteria
- [ ] Redis integration implemented
- [ ] Cache hit/miss metrics logged
- [ ] Cache TTL configured appropriately
- [ ] Cache invalidation works
- [ ] Performance improvement measured

## Labels
\`backend\`, \`database\`, \`priority:medium\`, \`epic:sprint-2\`

## Estimate
4 hours`,
        labels: ['backend', 'database', 'priority:medium', 'epic:sprint-2'],
        assignee: null
      },
      {
        title: 'Set up monitoring, logging, and error tracking',
        body: `## Task
Implement observability:
- Structured logging (Winston or Pino)
- Error tracking (Sentry or similar)
- Basic metrics (request counts, errors)
- Health check endpoint

## Acceptance Criteria
- [ ] Structured logging implemented
- [ ] Error tracking is set up
- [ ] Basic metrics are collected
- [ ] Health endpoint includes system status
- [ ] Logs are retained for 30 days

## Labels
\`devops\`, \`backend\`, \`priority:medium\`, \`epic:sprint-2\`

## Estimate
4 hours`,
        labels: ['devops', 'backend', 'priority:medium', 'epic:sprint-2'],
        assignee: null
      },
      {
        title: 'Deploy static frontend to Cloudflare Pages',
        body: `## Task
Deploy the React/Vite app to Cloudflare:
- Set up Cloudflare Pages project
- Connect to GitHub repository
- Configure build settings
- Deploy to production

## Acceptance Criteria
- [ ] Cloudflare Pages project exists
- [ ] Connected to GitHub repo
- [ ] Auto-deploys on push to main
- [ ] Site is accessible at Cloudflare URL
- [ ] Build logs are accessible

## Labels
\`frontend\`, \`devops\`, \`priority:high\`, \`epic:sprint-2\`

## Estimate
2 hours`,
        labels: ['frontend', 'devops', 'priority:high', 'epic:sprint-2'],
        assignee: null
      }
    ],
    
    'Sprint 3': [
      {
        title: 'Migrate core generator.js to TypeScript',
        body: `## Task
Convert the main generator to TypeScript:
- Add type definitions for all functions
- Type all interfaces (Case, Truth, Presentation, etc.)
- Configure tsconfig.json
- Fix any type errors

## Acceptance Criteria
- [ ] \`tsconfig.json\` exists with proper configuration
- [ ] \`src/generator.ts\` exists (or gradual migration)
- [ ] All major types are defined
- [ ] Build process works with TypeScript
- [ ] No type errors in core paths

## Labels
\`frontend\`, \`backend\`, \`priority:high\`, \`epic:sprint-3\`

## Estimate
12 hours`,
        labels: ['frontend', 'backend', 'priority:high', 'epic:sprint-3'],
        assignee: null
      },
      {
        title: 'Split generator.js into domain-specific modules',
        body: `## Task
Split the 1820-line generator.js into modules:
- \`distributions.ts\` - Statistical sampling functions
- \`corruption.ts\` - Fraud/corruption logic
- \`evidence.ts\` - Evidence synthesis
- \`decision.ts\` - Decision engine
- \`ledger.ts\` - Cash flow ledger logic

## Acceptance Criteria
- [ ] \`src/distributions.ts\` exists
- [ ] \`src/corruption.ts\` exists
- [ ] \`src/evidence.ts\` exists
- [ ] \`src/decision.ts\` exists
- [ ] \`src/ledger.ts\` exists
- [ ] All imports work correctly
- [ ] No circular dependencies

## Labels
\`backend\`, \`priority:high\`, \`epic:sprint-3\`

## Estimate
8 hours`,
        labels: ['backend', 'priority:high', 'epic:sprint-3'],
        assignee: null
      },
      {
        title: 'Remove redundant npm dependencies',
        body: `## Task
Audit and remove unnecessary dependencies:
- Remove \`gaussian\` (internal normal sampling exists)
- Remove \`random-js\` (Mulberry32 PRNG internal)
- Review \`mathjs\` and \`simple-statistics\` usage
- Update package.json

## Acceptance Criteria
- [ ] \`gaussian\` removed from package.json
- [ ] \`random-js\` removed from package.json
- [ ] Unused functions from mathjs/simple-statistics identified
- [ ] All tests still pass
- [ ] Bundle size reduced

## Labels
\`backend\`, \`devops\`, \`priority:medium\`, \`epic:sprint-3\`

## Estimate
2 hours`,
        labels: ['backend', 'devops', 'priority:medium', 'epic:sprint-3'],
        assignee: null
      },
      {
        title: 'Add Jest/Vitest unit tests for core functions',
        body: `## Task
Add comprehensive unit tests:
- Test statistical sampling functions
- Test corruption logic
- Test decision engine
- Test ledger accounting
- Aim for >80% coverage

## Acceptance Criteria
- [ ] Jest or Vitest configured
- [ ] Tests for \`generateCase()\` exist
- [ ] Tests for \`corruptPresentation()\` exist
- [ ] Tests for \`computeDecision()\` exist
- [ ] Tests for \`simulateMonthlyLedger()\` exist
- [ ] Coverage >80%

## Labels
\`backend\`, \`frontend\`, \`priority:high\`, \`epic:sprint-3\`

## Estimate
8 hours`,
        labels: ['backend', 'frontend', 'priority:high', 'epic:sprint-3'],
        assignee: null
      },
      {
        title: 'Add React error boundaries to frontend',
        body: `## Task
Add error handling to React UI:
- Create error boundary component
- Wrap main app components
- Display user-friendly error messages
- Log errors to console/sentry

## Acceptance Criteria
- [ ] ErrorBoundary component exists
- [ ] Main app is wrapped in ErrorBoundary
- [ ] User-friendly error messages display
- [ ] Errors are logged
- [ ] App doesn't crash on errors

## Labels
\`frontend\`, \`priority:medium\`, \`epic:sprint-3\`

## Estimate
2 hours`,
        labels: ['frontend', 'priority:medium', 'epic:sprint-3'],
        assignee: null
      },
      {
        title: 'Build web dashboard for case configuration',
        body: `## Task
Create a web-based configuration UI:
- Form for generating individual cases
- Form for batch generation
- Configuration preset management
- Export options (JSON, CSV)

## Acceptance Criteria
- [ ] Configuration form works
- [ ] Case generation works from UI
- [ ] Batch generation form works
- [ ] Presets can be saved/loaded
- [ ] Export options work

## Labels
\`frontend\`, \`enhancement\`, \`priority:medium\`, \`epic:sprint-3\`

## Estimate
8 hours`,
        labels: ['frontend', 'enhancement', 'priority:medium', 'epic:sprint-3'],
        assignee: null
      }
    ],
    
    'Sprint 4': [
      {
        title: 'Extend generator to support auto, personal, commercial loans',
        body: `## Task
Add support for additional loan types:
- Auto loan configurations
- Personal loan configurations
- Commercial loan configurations
- Loan-type-specific parameters
- Updated UI to select loan type

## Acceptance Criteria
- [ ] \`loan_type\` parameter accepts: MORTGAGE, AUTO, PERSONAL, COMMERCIAL
- [ ] Each loan type has appropriate parameters
- [ ] Decision engine handles all loan types
- [ ] UI allows loan type selection
- [ ] Documentation updated

## Labels
\`backend\`, \`enhancement\`, \`priority:high\`, \`epic:sprint-4\`

## Estimate
8 hours`,
        labels: ['backend', 'enhancement', 'priority:high', 'epic:sprint-4'],
        assignee: null
      },
      {
        title: 'Add charts and visualizations to UI',
        body: `## Task
Add visualization using Chart.js or similar:
- Distribution histograms (age, salary, credit score)
- Correlation heatmap
- Fraud pattern breakdown
- Decision outcome pie chart
- Time series for batch generation

## Acceptance Criteria
- [ ] Chart.js or similar library added
- [ ] Salary distribution chart works
- [ ] Credit score distribution chart works
- [ ] Fraud type breakdown chart works
- [ ] Decision outcome chart works
- [ ] Charts are responsive

## Labels
\`frontend\`, \`enhancement\`, \`priority:medium\`, \`epic:sprint-4\`

## Estimate
6 hours`,
        labels: ['frontend', 'enhancement', 'priority:medium', 'epic:sprint-4'],
        assignee: null
      },
      {
        title: 'Create UI for custom fraud pattern configuration',
        body: `## Task
Allow users to create custom fraud patterns:
- UI form for defining new corruption types
- Backend validation
- Save custom patterns to database
- Apply custom patterns to generation

## Acceptance Criteria
- [ ] Custom fraud pattern form exists
- [ ] Patterns are validated
- [ ] Patterns saved to database
- [ ] Patterns can be applied to generation
- [ ] Patterns can be shared/exported

## Labels
\`frontend\`, \`backend\`, \`enhancement\`, \`priority:medium\`, \`epic:sprint-4\`

## Estimate
8 hours`,
        labels: ['frontend', 'backend', 'enhancement', 'priority:medium', 'epic:sprint-4'],
        assignee: null
      },
      {
        title: 'Add versioning system for generated datasets',
        body: `## Task
Track dataset versions:
- Version number for each dataset
- Changelog between versions
- Reproduce old datasets from version + seed
- List version history

## Acceptance Criteria
- [ ] Datasets have version numbers
- [ ] Version history is stored
- [ ] Old versions can be reproduced
- [ ] Version changes are logged
- [ ] API returns version info

## Labels
\`backend\`, \`database\`, \`priority:medium\`, \`epic:sprint-4\`

## Estimate
4 hours`,
        labels: ['backend', 'database', 'priority:medium', 'epic:sprint-4'],
        assignee: null
      },
      {
        title: 'Implement tiered rate limiting for API',
        body: `## Task
Add rate limiting with tiers:
- Free tier: 1000 requests/hour
- Pro tier: 10000 requests/hour
- Enterprise: custom
- Track usage per API key

## Acceptance Criteria
- [ ] Rate limiting implemented
- [ ] Free tier limits enforced
- [ ] Pro tier limits enforced
- [ ] Usage is tracked per key
- [ ] Rate limit headers included in responses

## Labels
\`backend\`, \`devops\`, \`priority:high\`, \`epic:sprint-4\`

## Estimate
4 hours`,
        labels: ['backend', 'devops', 'priority:high', 'epic:sprint-4'],
        assignee: null
      },
      {
        title: 'Deploy complete application to production',
        body: `## Task
Full production deployment:
- Cloudflare Pages for frontend
- Cloudflare Workers for API
- PostgreSQL database
- Custom domain configured
- SSL certificates
- Monitoring setup

## Acceptance Criteria
- [ ] Frontend deployed to production
- [ ] API deployed to production
- [ ] Database in production
- [ ] Custom domain works
- [ ] SSL certificates valid
- [ ] Monitoring is active

## Labels
\`devops\`, \`priority:high\`, \`epic:sprint-4\`

## Estimate
4 hours`,
        labels: ['devops', 'priority:high', 'epic:sprint-4'],
        assignee: null
      }
    ]
  }
};

// ============================================================================
// MANUAL SETUP INSTRUCTIONS
// ============================================================================

console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║                   CASE EXPLORER: 90-DAY ROADMAP SETUP                     ║
║                         Manual Setup Instructions                         ║
╚══════════════════════════════════════════════════════════════════════════╝

📋 OVERVIEW
─────────────────────────────────────────────────────────────────────────────
This script provides guidance for setting up the GitHub Projects board for the
Case Explorer 90-day roadmap. You can use either:

1. GitHub UI (Recommended for most users)
2. GitHub API (For automation)

✅ STEP 1: CREATE PROJECTS BOARD (GitHub UI)
─────────────────────────────────────────────────────────────────────────────

1. Go to: https://github.com/emkwambe/case-explorer/projects
2. Click "New project" → "Board"
3. Select "Case Explorer: 90-Day Roadmap" template or create blank
4. Name: "Case Explorer: 90-Day Roadmap"
5. Description: "90-day development roadmap for the Case Explorer synthetic underwriting data platform"
6. Visibility: Public
7. Click "Create project"

✅ STEP 2: CONFIGURE COLUMNS
─────────────────────────────────────────────────────────────────────────────

1. Click "..." (More) → "Manage" → "Columns"
2. Delete default columns
3. Add these columns in order:
   - "📝 To Do" (color: #FBFEF9 or default)
   - "👨‍💻 In Progress" (color: #E9F5FB or default)
   - "👀 In Review" (color: #FEF2E6 or default)
   - "✅ Done" (color: #E6FBF4 or default)
   - "❌ Blocked" (color: #FFE1E4 or default)

✅ STEP 3: CREATE MILESTONES
─────────────────────────────────────────────────────────────────────────────

Go to: https://github.com/emkwambe/case-explorer/milestones

Create these milestones:

${PROJECT_CONFIG.milestones.map(m => `  ✓ ${m.title}
    - Due: ${m.due_on.split('T')[0]}
    - Description: ${m.description}
    - State: ${m.state}
`).join('\n')}

✅ STEP 4: CREATE LABELS
─────────────────────────────────────────────────────────────────────────────

Go to: https://github.com/emkwambe/case-explorer/labels

Create these labels (click "New label"):

${PROJECT_CONFIG.labels.map(l => `  ✓ ${l.name} (${l.color}, ${l.description})`).join('\n')}

✅ STEP 5: CREATE ISSUES
─────────────────────────────────────────────────────────────────────────────

For each sprint, create issues with the titles and descriptions below.
After creating each issue:
- Assign to the appropriate milestone
- Add the specified labels
- Add to the Projects board

📌 SPRINT 0 ISSUES (7 issues):
─────────────────────────────────────────────────────────────────────────────
${PROJECT_CONFIG.issues['Sprint 0'].map((i, idx) => `${idx + 1}. **${i.title}**
   - Labels: ${i.labels.join(', ')}
   - Milestone: Sprint 0: Foundation
   - Description: ${i.body.split('\n')[0]}
   - Estimate: ${i.body.split('## Estimate\n')[1] || 'Not specified'}
`).join('\n\n')}

📌 SPRINT 1 ISSUES (6 issues):
─────────────────────────────────────────────────────────────────────────────
${PROJECT_CONFIG.issues['Sprint 1'].map((i, idx) => `${idx + 1}. **${i.title}**
   - Labels: ${i.labels.join(', ')}
   - Milestone: Sprint 1: API & Core
   - Description: ${i.body.split('\n')[0]}
   - Estimate: ${i.body.split('## Estimate\n')[1] || 'Not specified'}
`).join('\n\n')}

📌 SPRINT 2 ISSUES (5 issues):
─────────────────────────────────────────────────────────────────────────────
${PROJECT_CONFIG.issues['Sprint 2'].map((i, idx) => `${idx + 1}. **${i.title}**
   - Labels: ${i.labels.join(', ')}
   - Milestone: Sprint 2: Scalability
   - Description: ${i.body.split('\n')[0]}
   - Estimate: ${i.body.split('## Estimate\n')[1] || 'Not specified'}
`).join('\n\n')}

📌 SPRINT 3 ISSUES (6 issues):
─────────────────────────────────────────────────────────────────────────────
${PROJECT_CONFIG.issues['Sprint 3'].map((i, idx) => `${idx + 1}. **${i.title}**
   - Labels: ${i.labels.join(', ')}
   - Milestone: Sprint 3: Productization
   - Description: ${i.body.split('\n')[0]}
   - Estimate: ${i.body.split('## Estimate\n')[1] || 'Not specified'}
`).join('\n\n')}

📌 SPRINT 4 ISSUES (5 issues):
─────────────────────────────────────────────────────────────────────────────
${PROJECT_CONFIG.issues['Sprint 4'].map((i, idx) => `${idx + 1}. **${i.title}**
   - Labels: ${i.labels.join(', ')}
   - Milestone: Sprint 4: Advanced Features
   - Description: ${i.body.split('\n')[0]}
   - Estimate: ${i.body.split('## Estimate\n')[1] || 'Not specified'}
`).join('\n\n')}

✅ STEP 6: ADD ISSUES TO PROJECTS BOARD
─────────────────────────────────────────────────────────────────────────────

1. Go to the Projects board: https://github.com/users/emkwambe/projects/[PROJECT_NUMBER]
2. Click "Add items" → "Issues"
3. Select all issues from the repository
4. Click "Add [X] items"
5. Drag issues to appropriate columns:
   - All issues start in "📝 To Do"
   - Issues being worked on move to "👨‍💻 In Progress"
   - PRs move to "👀 In Review"
   - Merged PRs move to "✅ Done"
   - Blocked issues move to "❌ Blocked"

✅ STEP 7: CONFIGURE AUTOMATION
─────────────────────────────────────────────────────────────────────────────

1. Go to the Projects board
2. Click "..." (More) → "Manage" → "Workflow" → "Automation"
3. Click "Add automation"
4. Create these rules:

   Rule 1: Move PR to "In Review" when opened
   - Trigger: "When pull request is opened"
   - Action: "Set status to In Review" and "Add to In Review column"

   Rule 2: Move PR to "Done" when merged
   - Trigger: "When pull request is merged"
   - Action: "Set status to Done" and "Add to Done column"

   Rule 3: Move Issue to "In Progress" when assigned
   - Trigger: "When issue is assigned"
   - Action: "Set status to In Progress" and "Add to In Progress column"

✅ STEP 8: ADD EXISTING FILES TO REPO
─────────────────────────────────────────────────────────────────────────────

The following files have been created and should be committed:
- PROJECT.md (repo root)
- docs/ARCHITECTURE.md
- .github/ISSUE_TEMPLATE/bug_report.md
- .github/ISSUE_TEMPLATE/feature_request.md
- .github/pull_request_template.md

Commit and push these files:
  git add PROJECT.md docs/ARCHITECTURE.md .github/
  git commit -m "Add project documentation and issue templates"
  git push origin main

✅ STEP 9: VERIFY SETUP
─────────────────────────────────────────────────────────────────────────────

Checklist:
- [ ] Projects board created with correct name
- [ ] All 5 columns configured
- [ ] All 5 milestones created
- [ ] All 29 issues created
- [ ] All issues have correct labels
- [ ] All issues assigned to correct milestones
- [ ] All issues added to Projects board
- [ ] Automation rules configured
- [ ] Documentation files committed

═══════════════════════════════════════════════════════════════════════════

🎯 QUICK START (For the impatient)
─────────────────────────────────────────────────────────────────────────────

If you just want to get started quickly:

1. ✅ Files already created: PROJECT.md, docs/ARCHITECTURE.md, issue templates
2. ⬆️  Push these files to GitHub
3. 📋 Create Projects board manually (Steps 1-2 above)
4. 🏷️  Create labels (Step 4 above)
5. 🎯 Create milestones (Step 3 above)
6. 📝 Create issues (Step 5 above) - Use the issue content from this file
7. 🤖 Configure automation (Step 7 above)

═══════════════════════════════════════════════════════════════════════════

📊 SUMMARY
─────────────────────────────────────────────────────────────────────────────
Total: 29 issues across 5 sprints (2 weeks each)
- Sprint 0: 7 issues (Foundation)
- Sprint 1: 6 issues (API & Core)
- Sprint 2: 5 issues (Scalability)
- Sprint 3: 6 issues (Productization)
- Sprint 4: 5 issues (Advanced Features)

Estimated Total Effort: ~190-200 hours
Expected Completion: 2026-10-09 (10 weeks)

═══════════════════════════════════════════════════════════════════════════
`);

// Export for use in other scripts
module.exports = PROJECT_CONFIG;
