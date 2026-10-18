# Case Explorer: Complete Setup Guide

## 🎯 Overview

This comprehensive guide will walk you through setting up the **GitHub Projects board** and all infrastructure for the **Case Explorer 90-Day Roadmap**. Follow these steps in order.

**Estimated Time:** 1-2 hours (depending on your familiarity with GitHub)

---

## 📋 Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Step 1: Create GitHub Projects Board](#2-step-1-create-github-projects-board)
3. [Step 2: Configure Columns](#3-step-2-configure-columns)
4. [Step 3: Create Milestones](#4-step-3-create-milestones)
5. [Step 4: Create Labels](#5-step-4-create-labels)
6. [Step 5: Create Issues](#6-step-5-create-issues)
7. [Step 6: Add Issues to Projects Board](#7-step-6-add-issues-to-projects-board)
8. [Step 7: Configure Automation](#8-step-7-configure-automation)
9. [Step 8: Set Up CI/CD Pipeline](#9-step-8-set-up-cicd-pipeline)
10. [Step 9: Configure Database](#10-step-9-configure-database)
11. [Step 10: Verify Setup](#11-step-10-verify-setup)
12. [Bonus: Advanced Configuration](#12-bonus-advanced-configuration)

---

## 1️⃣ Prerequisites

Before you begin, ensure you have:

### ✅ Required
- A **GitHub account** with admin access to `emkwambe/case-explorer`
- A **web browser** (Chrome, Firefox, Safari, or Edge)
- **Node.js 20+** installed locally (for testing)
- **npm** or **yarn** package manager

### ⚠️ Optional (for full setup)
- **PostgreSQL** (local or cloud via Supabase/Neon)
- **Docker** (for local PostgreSQL)
- **psql** command-line tool
- **Slack** workspace (for team communication)

### 📥 Clone the Repository

If you haven't already:
```bash
git clone https://github.com/emkwambe/case-explorer.git
cd case-explorer
```

### 🔄 Pull Latest Changes

```bash
git pull origin main
```

All the configuration files you need are already in the repository:
- ✅ `PROJECT.md` - Roadmap documentation
- ✅ `docs/ARCHITECTURE.md` - Architecture documentation
- ✅ `.github/ISSUE_TEMPLATE/*.md` - Issue templates
- ✅ `.github/pull_request_template.md` - PR template
- ✅ `.github/workflows/ci.yml` - CI/CD pipeline
- ✅ `docs/DB_SETUP.md` - Database setup guide
- ✅ `docs/db/schema.sql` - PostgreSQL schema
- ✅ `.env.example` - Environment variables template
- ✅ `scripts/import_issues.csv` - Bulk import CSV
- ✅ `scripts/setup_github_projects.js` - Setup configuration

---

## 2️⃣ Step 1: Create GitHub Projects Board

**Time:** 2-3 minutes

### 📍 Navigation
1. Open your browser
2. Go to: `https://github.com/emkwambe/case-explorer/projects`
3. Click the green button: **"New project"**

### 🎨 Create Project
1. Select **"Board"** (not "Table" or "Roadmap")
2. **Project name:** `Case Explorer: 90-Day Roadmap`
3. **Description:** `90-day development roadmap for the Case Explorer synthetic underwriting data platform`
4. **Visibility:** `Public`
5. **Template:** `Blank` (or select a template if preferred)
6. Click **"Create project"**

**✅ Success:** You should now see an empty Projects board with the title "Case Explorer: 90-Day Roadmap"

### 📌 Pro Tip
> The URL will be: `https://github.com/users/emkwambe/projects/[PROJECT_NUMBER]`
> Save this URL for future reference

---

## 3️⃣ Step 2: Configure Columns

**Time:** 2-3 minutes

### 🔧 Manage Columns
1. On your Projects board, click the **"..."** (More) button in the top-right
2. Select **"Manage"**
3. Click on **"Columns"** tab

### 🗑️ Remove Default Columns
1. Click the **"..."** next to "To do" → **"Delete"**
2. Delete "In progress"
3. Delete "Done"

### ➕ Add Custom Columns
Click **"Add column"** and create these 5 columns in this exact order:

| Column Name | Emoji | Color (Optional) | Purpose |
|-------------|-------|------------------|---------|
| To Do | 📝 | Default | Backlog of prioritized tasks |
| In Progress | 👨‍💻 | Default | Actively being worked on |
| In Review | 👀 | Default | PRs and issues ready for review |
| Done | ✅ | Default | Completed tasks |
| Blocked | ❌ | Default | Tasks waiting on dependencies |

**How to add each column:**
1. Click **"Add column"**
2. Enter the name (include the emoji)
3. Click **"Create"**
4. Repeat for all 5 columns

### 🎯 Verify
- You should see 5 columns across the top of your board
- They should appear in the order listed above

---

## 4️⃣ Step 3: Create Milestones

**Time:** 5-7 minutes

### 🎯 Navigation
1. Go to: `https://github.com/emkwambe/case-explorer/milestones`
2. Or: From the repo, click **"Issues"** → **"Milestones"**

### 📅 Create Sprint Milestones

Click **"New milestone"** and create each of these 5 milestones:

#### **Milestone 1: Sprint 0 - Foundation**
- **Title:** `Sprint 0: Foundation`
- **Description:** `Establish infrastructure for the 90-day roadmap with CI/CD, database, and documentation.`
- **Due date:** `2026-08-14` (2 weeks from now)
- **State:** `Open`
- Click **"Create milestone"**

#### **Milestone 2: Sprint 1 - API & Core**
- **Title:** `Sprint 1: API & Core`
- **Description:** `Build REST API with authentication and core case generation endpoints.`
- **Due date:** `2026-08-28` (4 weeks from now)
- **State:** `Open`
- Click **"Create milestone"**

#### **Milestone 3: Sprint 2 - Scalability**
- **Title:** `Sprint 2: Scalability`
- **Description:** `Add database persistence, worker threads, and performance optimizations.`
- **Due date:** `2026-09-11` (6 weeks from now)
- **State:** `Open`
- Click **"Create milestone"**

#### **Milestone 4: Sprint 3 - Productization**
- **Title:** `Sprint 3: Productization`
- **Description:** `Migrate to TypeScript, modularize codebase, add unit tests, and improve UI.`
- **Due date:** `2026-09-25` (8 weeks from now)
- **State:** `Open`
- Click **"Create milestone"**

#### **Milestone 5: Sprint 4 - Advanced Features**
- **Title:** `Sprint 4: Advanced Features`
- **Description:** `Add multi-loan type support, visualization, custom fraud patterns, and deploy to production.`
- **Due date:** `2026-10-09` (10 weeks from now)
- **State:** `Open`
- Click **"Create milestone"**

### ✅ Verify
- Go back to the milestones page
- You should see 5 open milestones
- Each should have the correct due dates

---

## 5️⃣ Step 4: Create Labels

**Time:** 5-7 minutes

### 🏷️ Navigation
1. Go to: `https://github.com/emkwambe/case-explorer/labels`
2. Or: From the repo, click **"Issues"** → **"Labels"**

### 🎨 Create All Labels

Click **"New label"** and create each label with these exact specifications:

#### **Category Labels**

| Label Name | Color Code | Description |
|------------|------------|-------------|
| `frontend` | `#1d76db` | React/UI tasks |
| `backend` | `#0075ca` | Node.js/API tasks |
| `database` | `#009800` | Database-related tasks |
| `devops` | `#8957e5` | Infrastructure, CI/CD |
| `documentation` | `#1d76db` | Docs and guides |
| `bug` | `#d73a49` | Bug fixes |
| `enhancement` | `#0075ca` | New features |

#### **Priority Labels**

| Label Name | Color Code | Description |
|------------|------------|-------------|
| `priority:high` | `#d73a49` | High priority |
| `priority:medium` | `#fbcbeb` | Medium priority |
| `priority:low` | `#c2e0c6` | Low priority |

#### **Epic Labels**

| Label Name | Color Code | Description |
|------------|------------|-------------|
| `epic:sprint-0` | `#fef2c0` | Sprint 0 epic |
| `epic:sprint-1` | `#fef2c0` | Sprint 1 epic |
| `epic:sprint-2` | `#fef2c0` | Sprint 2 epic |
| `epic:sprint-3` | `#fef2c0` | Sprint 3 epic |
| `epic:sprint-4` | `#fef2c0` | Sprint 4 epic |

### 📝 How to Create Each Label

1. Click **"New label"**
2. **Label name:** Enter the name exactly as shown above
3. **Description:** Enter the description
4. **Color:** Click the color swatch and paste the hex code (without `#`)
   - For `#1d76db` → enter `1d76db`
   - For `#d73a49` → enter `d73a49`
5. Click **"Create label"**
6. Repeat for all 17 labels

### ✅ Verify
- You should have 17 labels total
- Check that colors match the specifications

---

## 6️⃣ Step 5: Create Issues

**Time:** 20-30 minutes

### 📝 Navigation
1. Go to: `https://github.com/emkwambe/case-explorer/issues`
2. Click **"New issue"**

### 📋 Issue Creation Method

You have **3 options** to create issues:

#### **Option A: Manual Creation (Recommended)**
Create each issue individually using the information below.

#### **Option B: Bulk Import via CSV**
Use the `scripts/import_issues.csv` file:
1. Go to **Settings** → **Import & Export** → **Import code**
2. Select **"Issues"**
3. Upload the CSV file
4. Map the columns

#### **Option C: Copy-Paste from Script**
Use `scripts/setup_github_projects.js` as a reference for issue content.

---

### 🎯 Sprint 0 Issues (7 issues)

#### **Issue 1: Set up GitHub Projects board**
- **Title:** `Set up GitHub Projects board with columns and milestones`
- **Description:** (Copy from below)
- **Labels:** `devops`, `priority:high`, `epic:sprint-0`
- **Milestone:** Sprint 0: Foundation
- **Assignees:** (Assign to yourself or Project Manager)

**Description:**
```markdown
## Task
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
`devops`, `priority:high`, `epic:sprint-0`

## Estimate
2 hours
```

#### **Issue 2: Set up CI/CD pipeline**
- **Title:** `Set up CI/CD pipeline with GitHub Actions`
- **Description:**
```markdown
## Task
Create GitHub Actions workflows to automate:
- Running tests on pull requests (lint, validate)
- Running tests on pushes to main
- Building and deploying the static site
- Automating release process

## Acceptance Criteria
- [ ] `.github/workflows/ci.yml` exists
- [ ] Workflow runs on PR to `main` branch
- [ ] Workflow runs `npm run lint` successfully
- [ ] Workflow runs `npm run validate` successfully
- [ ] Workflow runs `npm run build` successfully
- [ ] Workflow fails and blocks merge if tests fail

## Labels
`devops`, `backend`, `priority:high`, `epic:sprint-0`

## Estimate
4 hours
```
- **Labels:** `devops`, `backend`, `priority:high`, `epic:sprint-0`
- **Milestone:** Sprint 0: Foundation

#### **Issue 3: Configure PostgreSQL database**
- **Title:** `Configure PostgreSQL database (local + cloud)`
- **Description:**
```markdown
## Task
Set up PostgreSQL database for development and production:
- Local PostgreSQL setup instructions
- Cloud database on Supabase or Neon.tech
- Connection string management (environment variables)
- Basic schema for cases, users, configurations

## Acceptance Criteria
- [ ] `docs/DB_SETUP.md` created with setup instructions
- [ ] Local PostgreSQL connection works
- [ ] Cloud PostgreSQL instance created and configured
- [ ] `.env.example` contains all required DB variables
- [ ] Basic schema SQL file created (`docs/db/schema.sql`)

## Labels
`database`, `backend`, `devops`, `priority:high`, `epic:sprint-0`

## Estimate
6 hours
```
- **Labels:** `database`, `backend`, `devops`, `priority:high`, `epic:sprint-0`
- **Milestone:** Sprint 0: Foundation

#### **Issue 4: Create PROJECT.md**
- **Title:** `Create PROJECT.md with 90-day roadmap overview`
- **Description:** (This is already done! But create the issue to track it)
```markdown
## Task
Create a comprehensive `PROJECT.md` file at the repo root that includes:
- Project vision and goals
- 90-day roadmap with sprint summaries
- Sprint objectives
- Team roles and responsibilities
- Links to resources (board, docs, Slack)

## Acceptance Criteria
- [ ] `PROJECT.md` exists at repo root
- [ ] Contains project vision and goals
- [ ] Contains 90-day roadmap with sprint summaries
- [ ] Contains team contact information
- [ ] Links to GitHub Projects board

## Labels
`documentation`, `priority:high`, `epic:sprint-0`

## Estimate
2 hours

## Note
✅ This task is already complete! The file exists in the repository.
```
- **Labels:** `documentation`, `priority:high`, `epic:sprint-0`
- **Milestone:** Sprint 0: Foundation

#### **Issue 5: Document architecture**
- **Title:** `Document current architecture with Mermaid diagrams`
- **Description:** (This is already done!)
```markdown
## Task
Create `docs/ARCHITECTURE.md` with:
- High-level system architecture diagram (Mermaid.js)
- Component descriptions
- Data flow explanations
- Technology stack overview
- Deployment architecture

## Acceptance Criteria
- [ ] `docs/ARCHITECTURE.md` exists
- [ ] Contains at least 2 Mermaid diagrams
- [ ] Describes all major components
- [ ] Explains data flow
- [ ] Lists technology stack

## Labels
`documentation`, `priority:high`, `epic:sprint-0`

## Estimate
4 hours

## Note
✅ This task is already complete! The file exists in the repository.
```
- **Labels:** `documentation`, `priority:high`, `epic:sprint-0`
- **Milestone:** Sprint 0: Foundation

#### **Issue 6: Create Slack channel**
- **Title:** `Create #case-explorer Slack channel for team communication`
- **Description:**
```markdown
## Task
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
`devops`, `priority:medium`, `epic:sprint-0`

## Estimate
1 hour
```
- **Labels:** `devops`, `priority:medium`, `epic:sprint-0`
- **Milestone:** Sprint 0: Foundation

#### **Issue 7: Create templates**
- **Title:** `Create GitHub issue and PR templates`
- **Description:** (This is already done!)
```markdown
## Task
Create standardized templates for:
- Bug reports
- Feature requests
- Pull requests
- Documentation requests

## Acceptance Criteria
- [ ] `.github/ISSUE_TEMPLATE/bug_report.md` exists
- [ ] `.github/ISSUE_TEMPLATE/feature_request.md` exists
- [ ] `.github/pull_request_template.md` exists
- [ ] Templates include all required fields

## Labels
`devops`, `documentation`, `priority:medium`, `epic:sprint-0`

## Estimate
2 hours

## Note
✅ This task is already complete! The templates exist in the repository.
```
- **Labels:** `devops`, `documentation`, `priority:medium`, `epic:sprint-0`
- **Milestone:** Sprint 0: Foundation

---

### 📋 Sprint 1 Issues (6 issues)

#### **Issue 8: Design API specification**
- **Title:** `Design REST API specification`
- **Description:**
```markdown
## Task
Design the API specification using OpenAPI/Swagger:
- Endpoints for case generation
- Endpoints for batch generation
- Authentication endpoints
- Rate limiting strategy
- Error handling standards

## Acceptance Criteria
- [ ] `docs/api/openapi.yaml` or `openapi.json` exists
- [ ] All major endpoints are defined
- [ ] Request/response schemas are documented
- [ ] Authentication flow is documented
- [ ] Reviewed by team

## Labels
`backend`, `documentation`, `priority:high`, `epic:sprint-1`

## Estimate
4 hours
```
- **Labels:** `backend`, `documentation`, `priority:high`, `epic:sprint-1`
- **Milestone:** Sprint 1: API & Core

#### **Issue 9: Implement Express API server**
- **Title:** `Implement Express.js API server for case generation`
- **Description:**
```markdown
## Task
Create a Node.js/Express server that:
- Exposes REST endpoints from the API spec
- Integrates with the existing generator.js
- Handles request validation
- Returns proper HTTP status codes

## Acceptance Criteria
- [ ] `src/server.js` or `src/api/index.js` exists
- [ ] `/api/health` endpoint works
- [ ] `/api/cases/generate` endpoint works
- [ ] `/api/cases/batch` endpoint works
- [ ] Request validation implemented
- [ ] Error handling implemented

## Labels
`backend`, `priority:high`, `epic:sprint-1`

## Estimate
8 hours
```
- **Labels:** `backend`, `priority:high`, `epic:sprint-1`
- **Milestone:** Sprint 1: API & Core

#### **Issue 10: Implement API authentication**
- **Title:** `Implement API key authentication for endpoints`
- **Description:**
```markdown
## Task
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
`backend`, `devops`, `priority:high`, `epic:sprint-1`

## Estimate
6 hours
```
- **Labels:** `backend`, `devops`, `priority:high`, `epic:sprint-1`
- **Milestone:** Sprint 1: API & Core

#### **Issue 11: Deploy API documentation**
- **Title:** `Deploy API documentation using Swagger UI or Redoc`
- **Description:**
```markdown
## Task
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
`backend`, `documentation`, `priority:medium`, `epic:sprint-1`

## Estimate
2 hours
```
- **Labels:** `backend`, `documentation`, `priority:medium`, `epic:sprint-1`
- **Milestone:** Sprint 1: API & Core

#### **Issue 12: Add input validation middleware**
- **Title:** `Add input validation middleware for API endpoints`
- **Description:**
```markdown
## Task
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
`backend`, `priority:medium`, `epic:sprint-1`

## Estimate
4 hours
```
- **Labels:** `backend`, `priority:medium`, `epic:sprint-1`
- **Milestone:** Sprint 1: API & Core

#### **Issue 13: Add unit tests for API**
- **Title:** `Add unit tests for API endpoints`
- **Description:**
```markdown
## Task
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
`backend`, `priority:medium`, `epic:sprint-1`

## Estimate
4 hours
```
- **Labels:** `backend`, `priority:medium`, `epic:sprint-1`
- **Milestone:** Sprint 1: API & Core

---

### 📋 Sprint 2 Issues (5 issues)

#### **Issue 14: Integrate PostgreSQL database**
- **Title:** `Integrate PostgreSQL database for case persistence`
- **Labels:** `backend`, `database`, `priority:high`, `epic:sprint-2`
- **Milestone:** Sprint 2: Scalability
- **Estimate:** 8 hours

#### **Issue 15: Implement worker threads**
- **Title:** `Implement worker threads for parallel case generation`
- **Labels:** `backend`, `priority:high`, `epic:sprint-2`
- **Milestone:** Sprint 2: Scalability
- **Estimate:** 6 hours

#### **Issue 16: Add Redis caching**
- **Title:** `Add Redis caching for frequent queries`
- **Labels:** `backend`, `database`, `priority:medium`, `epic:sprint-2`
- **Milestone:** Sprint 2: Scalability
- **Estimate:** 4 hours

#### **Issue 17: Set up monitoring**
- **Title:** `Set up monitoring, logging, and error tracking`
- **Labels:** `devops`, `backend`, `priority:medium`, `epic:sprint-2`
- **Milestone:** Sprint 2: Scalability
- **Estimate:** 4 hours

#### **Issue 18: Deploy to Cloudflare Pages**
- **Title:** `Deploy static frontend to Cloudflare Pages`
- **Labels:** `frontend`, `devops`, `priority:high`, `epic:sprint-2`
- **Milestone:** Sprint 2: Scalability
- **Estimate:** 2 hours

---

### 📋 Sprint 3 Issues (6 issues)

#### **Issue 19: Migrate to TypeScript**
- **Title:** `Migrate core generator.js to TypeScript`
- **Labels:** `frontend`, `backend`, `priority:high`, `epic:sprint-3`
- **Milestone:** Sprint 3: Productization
- **Estimate:** 12 hours

#### **Issue 20: Modularize generator**
- **Title:** `Split generator.js into domain-specific modules`
- **Labels:** `backend`, `priority:high`, `epic:sprint-3`
- **Milestone:** Sprint 3: Productization
- **Estimate:** 8 hours

#### **Issue 21: Remove redundant dependencies**
- **Title:** `Remove redundant npm dependencies`
- **Labels:** `backend`, `devops`, `priority:medium`, `epic:sprint-3`
- **Milestone:** Sprint 3: Productization
- **Estimate:** 2 hours

#### **Issue 22: Add unit tests**
- **Title:** `Add Jest/Vitest unit tests for core functions`
- **Labels:** `backend`, `frontend`, `priority:high`, `epic:sprint-3`
- **Milestone:** Sprint 3: Productization
- **Estimate:** 8 hours

#### **Issue 23: Add error boundaries**
- **Title:** `Add React error boundaries to frontend`
- **Labels:** `frontend`, `priority:medium`, `epic:sprint-3`
- **Milestone:** Sprint 3: Productization
- **Estimate:** 2 hours

#### **Issue 24: Build web dashboard**
- **Title:** `Build web dashboard for case configuration`
- **Labels:** `frontend`, `enhancement`, `priority:medium`, `epic:sprint-3`
- **Milestone:** Sprint 3: Productization
- **Estimate:** 8 hours

---

### 📋 Sprint 4 Issues (5 issues)

#### **Issue 25: Multi-loan type support**
- **Title:** `Extend generator to support auto, personal, commercial loans`
- **Labels:** `backend`, `enhancement`, `priority:high`, `epic:sprint-4`
- **Milestone:** Sprint 4: Advanced Features
- **Estimate:** 8 hours

#### **Issue 26: Add visualization**
- **Title:** `Add charts and visualizations to UI`
- **Labels:** `frontend`, `enhancement`, `priority:medium`, `epic:sprint-4`
- **Milestone:** Sprint 4: Advanced Features
- **Estimate:** 6 hours

#### **Issue 27: Custom fraud patterns**
- **Title:** `Create UI for custom fraud pattern configuration`
- **Labels:** `frontend`, `backend`, `enhancement`, `priority:medium`, `epic:sprint-4`
- **Milestone:** Sprint 4: Advanced Features
- **Estimate:** 8 hours

#### **Issue 28: Dataset versioning**
- **Title:** `Add versioning system for generated datasets`
- **Labels:** `backend`, `database`, `priority:medium`, `epic:sprint-4`
- **Milestone:** Sprint 4: Advanced Features
- **Estimate:** 4 hours

#### **Issue 29: Implement rate limiting**
- **Title:** `Implement tiered rate limiting for API`
- **Labels:** `backend`, `devops`, `priority:high`, `epic:sprint-4`
- **Milestone:** Sprint 4: Advanced Features
- **Estimate:** 4 hours

#### **Issue 30: Deploy to production**
- **Title:** `Deploy complete application to production`
- **Labels:** `devops`, `priority:high`, `epic:sprint-4`
- **Milestone:** Sprint 4: Advanced Features
- **Estimate:** 4 hours

---

## 7️⃣ Step 6: Add Issues to Projects Board

**Time:** 3-5 minutes

### 📍 Navigation
1. Go to your Projects board: `https://github.com/users/emkwambe/projects/[PROJECT_NUMBER]`
2. If you don't know the project number, go to: `https://github.com/emkwambe/case-explorer/projects`

### ➕ Add All Issues
1. Click the **"Add items"** button (top-right)
2. Select **"Issues"**
3. Click **"Select all"** to select all 30 issues
4. Click **"Add [30] items"**

### 🎯 Organize Issues
All 30 issues will be added to the **"To Do"** column by default.

**Optional:** If you want to pre-organize issues by sprint:
1. Drag issues with `epic:sprint-0` label to a specific section
2. Group Sprint 1 issues together
3. Continue for all sprints

*Note: It's fine to leave all issues in "To Do" initially. They'll be moved to "In Progress" as work begins.*

---

## 8️⃣ Step 7: Configure Automation

**Time:** 5 minutes

### ⚙️ Navigation
1. On your Projects board, click **"..."** → **"Manage"**
2. Click **"Workflow"** tab
3. Click **"Automation"**
4. Click **"Add automation"**

### 🤖 Create Rule 1: Move PR to "In Review"
1. **Name:** `Move PR to In Review when opened`
2. **Trigger:** `When pull request is opened`
3. **Action:** `Set status to In Review` and `Add to In Review column`
4. Click **"Create"**

### 🤖 Create Rule 2: Move PR to "Done"
1. **Name:** `Move PR to Done when merged`
2. **Trigger:** `When pull request is merged`
3. **Action:** `Set status to Done` and `Add to Done column`
4. Click **"Create"**

### 🤖 Create Rule 3: Move Issue to "In Progress"
1. **Name:** `Move Issue to In Progress when assigned`
2. **Trigger:** `When issue is assigned`
3. **Action:** `Set status to In Progress` and `Add to In Progress column`
4. Click **"Create"**

### ✅ Verify
- Go back to your Projects board
- The automation rules should be listed
- Test by assigning an issue to yourself - it should move to "In Progress"

---

## 9️⃣ Step 8: Set Up CI/CD Pipeline

**Time:** 5 minutes

### ✅ Good News!
The CI/CD workflow file is **already created** at: `.github/workflows/ci.yml`

### 🔧 Verify Workflow Exists
1. Go to: `https://github.com/emkwambe/case-explorer/actions`
2. Click **"I understand my workflows, go ahead and enable them"** if prompted
3. You should see **"CI/CD Pipeline"** in the list

### 🚀 Test the Workflow

#### Method 1: Push to Main
```bash
# Make a small change
echo "# Test" >> TEST.md
git add TEST.md
git commit -m "Test CI/CD"
git push origin main
```

Go to **Actions** tab → Click on the running workflow → Watch it execute

#### Method 2: Create a PR
```bash
# Create a feature branch
git checkout -b test-ci

# Make a change
echo "# Test" >> TEST.md
git add TEST.md
git commit -m "Test CI/CD on PR"
git push origin test-ci

# Create PR on GitHub
```

### ✅ Verify
- Workflow runs on push ✅
- Workflow runs on PR ✅
- All jobs pass (lint, test, build) ✅
- Workflow blocks merge if tests fail ✅

### 📝 Customize Workflow (Optional)

Edit `.github/workflows/ci.yml` to:
- Add more test steps
- Add deployment steps
- Add notifications
- Customize triggers

---

## 🔟 Step 9: Configure Database

**Time:** 10-30 minutes (depending on method chosen)

### 📖 Reference
All database setup instructions are in: `docs/DB_SETUP.md`

### 🏗️ Choose Your Method

#### **Option A: Local PostgreSQL with Docker (Recommended for Development)**

1. **Start PostgreSQL container:**
```bash
docker run --name case-explorer-db \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=case_explorer \
  -p 5432:5432 \
  -d postgres:15-alpine
```

2. **Create schema:**
```bash
psql -h localhost -U postgres -d case_explorer -f docs/db/schema.sql
```

3. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your credentials
```

4. **Test connection:**
```bash
node -e "const { Pool } = require('pg'); const pool = new Pool(); pool.query('SELECT NOW()').then(console.log).catch(console.error);"
```

#### **Option B: Cloud PostgreSQL with Supabase (Recommended for Production)**

1. **Sign up at:** https://supabase.com/
2. **Create new project:** `case-explorer`
3. **Copy connection string** from Database → Connection Settings
4. **Run schema:**
```bash
psql [connection-string] -f docs/db/schema.sql
```
5. **Configure `.env`:**
```bash
DB_HOST=[your-project-ref].supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=[your-password]
```

#### **Option C: Cloud PostgreSQL with Neon.tech**

1. **Sign up at:** https://neon.tech/
2. **Create new project**
3. **Copy connection string**
4. **Run schema:**
```bash
psql [connection-string] -f docs/db/schema.sql
```
5. **Configure `.env` with connection details**

### ✅ Verify
- [ ] PostgreSQL is running
- [ ] Schema is created
- [ ] Connection test succeeds
- [ ] `.env` file is configured

---

## 1️⃣0️ Step 10: Verify Setup

**Time:** 5-10 minutes

### ✅ Checklist

#### **GitHub Projects Board**
- [ ] Board exists with name "Case Explorer: 90-Day Roadmap"
- [ ] All 5 columns configured (To Do, In Progress, In Review, Done, Blocked)
- [ ] All 5 milestones created (Sprint 0-4)
- [ ] All 30 issues created
- [ ] All issues have correct labels
- [ ] All issues assigned to correct milestones
- [ ] All issues added to Projects board
- [ ] Automation rules configured (3 rules)

#### **Repository Files**
- [ ] `PROJECT.md` exists
- [ ] `docs/ARCHITECTURE.md` exists
- [ ] `.github/ISSUE_TEMPLATE/bug_report.md` exists
- [ ] `.github/ISSUE_TEMPLATE/feature_request.md` exists
- [ ] `.github/pull_request_template.md` exists
- [ ] `.github/workflows/ci.yml` exists
- [ ] `docs/DB_SETUP.md` exists
- [ ] `docs/db/schema.sql` exists
- [ ] `.env.example` exists
- [ ] `scripts/import_issues.csv` exists
- [ ] `scripts/setup_github_projects.js` exists

#### **CI/CD**
- [ ] Workflow file exists
- [ ] Workflow runs on push
- [ ] Workflow runs on PR
- [ ] Lint job passes
- [ ] Test job passes
- [ ] Build job passes

#### **Database**
- [ ] PostgreSQL is accessible
- [ ] Schema is created
- [ ] Connection works

### 🎉 Celebrate!

If all checks pass, **YOU'RE DONE!** 🎉

---

## 1️⃣1️⃣ Bonus: Advanced Configuration

### 🚀 Deploy to Cloudflare Pages

1. **Sign up at:** https://dash.cloudflare.com/sign-up
2. **Go to Workers & Pages** → **Create application**
3. **Select "Pages"**
4. **Connect GitHub repository:** `emkwambe/case-explorer`
5. **Project name:** `case-explorer`
6. **Production branch:** `main`
7. **Build command:** `npm run build`
8. **Build output directory:** `dist/`
9. **Click "Save and Deploy"**
10. **Wait 2-3 minutes** for first deployment
11. **Access your site** at the provided URL

### 📡 Set Up Cloudflare Workers for API

1. **Create new Worker:**
```bash
npm create cloudflare@latest case-explorer-api
cd case-explorer-api
```

2. **Configure `wrangler.toml`:**
```toml
name = "case-explorer-api"
main = "src/index.js"
compatibility_date = "2024-01-01"

[vars]
DATABASE_URL = "@database"
```

3. **Deploy:**
```bash
npm run deploy
```

### 🔐 Set Up API Key Authentication

Use the `api_keys` table schema and implement:

```javascript
// Middleware for API key authentication
async function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }
  
  // Look up API key in database
  const key = await db.query(
    'SELECT * FROM api_keys WHERE key_prefix = $1 AND is_active = TRUE',
    [apiKey.substring(0, 8)]
  );
  
  if (!key.rows[0]) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  // Verify full key hash
  const isValid = await bcrypt.compare(apiKey, key.rows[0].key_hash);
  
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  // Check rate limit
  if (key.rows[0].requests_this_hour >= key.rows[0].rate_limit_per_hour) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  
  // Update usage
  await db.query(
    'UPDATE api_keys SET requests_this_hour = requests_this_hour + 1, last_used_at = NOW() WHERE id = $1',
    [key.rows[0].id]
  );
  
  // Reset hourly counter if new hour
  await db.query(
    `UPDATE api_keys SET requests_this_hour = 0 WHERE last_request_at < NOW() - INTERVAL '1 hour'`
  );
  
  req.user = key.rows[0].user_id;
  req.apiKey = key.rows[0];
  next();
}
```

### 📊 Set Up Monitoring with Sentry

1. **Sign up at:** https://sentry.io/
2. **Create new project:** `case-explorer`
3. **Install SDK:**
```bash
npm install @sentry/node @sentry/integrations
```

4. **Configure in your API:**
```javascript
const Sentry = require('@sentry/node');
const Tracing = require('@sentry/tracing');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Tracing.Integrations.Express({
      app: app
    })
  ],
  tracesSampleRate: 1.0,
  environment: process.env.NODE_ENV || 'development'
});

app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.tracingHandler());

// The error handler must be before any other error middleware
app.use(Sentry.Handlers.errorHandler());
```

---

## 📚 Quick Reference

### 🔗 Important URLs

| Resource | URL |
|----------|-----|
| Repository | https://github.com/emkwambe/case-explorer |
| Projects Board | https://github.com/users/emkwambe/projects/[NUMBER] |
| Issues | https://github.com/emkwambe/case-explorer/issues |
| Milestones | https://github.com/emkwambe/case-explorer/milestones |
| Labels | https://github.com/emkwambe/case-explorer/labels |
| Actions | https://github.com/emkwambe/case-explorer/actions |

### 📁 Important Files

| File | Path | Purpose |
|------|------|---------|
| Projects Board Config | `scripts/setup_github_projects.js` | Board configuration reference |
| Issue CSV | `scripts/import_issues.csv` | Bulk issue import |
| CI/CD Workflow | `.github/workflows/ci.yml` | Automated testing |
| Database Schema | `docs/db/schema.sql` | PostgreSQL schema |
| DB Setup Guide | `docs/DB_SETUP.md` | Database instructions |
| Environment Template | `.env.example` | Configuration template |

### 🎯 Sprint Schedule

| Sprint | Dates | Focus | Issues |
|--------|-------|-------|--------|
| 0 | Aug 1-14 | Foundation | 7 |
| 1 | Aug 15-28 | API & Core | 6 |
| 2 | Aug 29-Sep 11 | Scalability | 5 |
| 3 | Sep 12-25 | Productization | 6 |
| 4 | Sep 26-Oct 9 | Advanced Features | 6 |

---

## 🆘 Troubleshooting

### ❌ Projects Board Not Showing Up
**Problem:** Created board but can't find it
**Solution:** Go to `https://github.com/emkwambe/case-explorer/projects` and look for it there

### ❌ Issues Not Appearing in Board
**Problem:** Created issues but they're not in the Projects board
**Solution:**
1. Go to Projects board
2. Click "Add items" → "Issues"
3. Select the issues you want to add
4. Click "Add [X] items"

### ❌ Automation Rules Not Working
**Problem:** PRs/issues not moving automatically
**Solution:**
1. Go to Projects board → "..." → "Manage" → "Workflow" → "Automation"
2. Verify rules are created correctly
3. Check that the trigger conditions are met

### ❌ CI/CD Workflow Not Running
**Problem:** Push/PR doesn't trigger workflow
**Solution:**
1. Go to Actions tab
2. Check if workflows are enabled
3. Click "I understand my workflows, go ahead and enable them"
4. Verify `.github/workflows/ci.yml` exists

### ❌ Database Connection Failing
**Problem:** Can't connect to PostgreSQL
**Solution:**
1. Verify PostgreSQL is running: `docker ps` or `ps aux | grep postgres`
2. Check credentials in `.env` file
3. Test connection manually: `psql -h localhost -U postgres -d case_explorer`
4. See `docs/DB_SETUP.md` for troubleshooting

---

## 🙌 Next Steps

Now that your Projects board is set up:

1. **Start Sprint 0** - Work on the foundation tasks
2. **Assign issues** to team members
3. **Hold sprint planning** meeting
4. **Begin development** on the first tasks
5. **Track progress** using the Projects board

---

## 📞 Support

If you encounter any issues:

1. **Check this guide** - Most questions are answered here
2. **Check `docs/` folder** - Contains detailed documentation
3. **Check `scripts/setup_github_projects.js`** - Has configuration reference
4. **Ask in Slack** - #case-explorer channel (once created)
5. **Create an issue** - Use the bug report template

---

## 🎉 Congratulations!

You've successfully set up the **GitHub Projects board** for the **Case Explorer 90-Day Roadmap**! 🎉

**What you've accomplished:**
- ✅ Created a Projects board with 5 columns
- ✅ Set up 5 milestones (Sprint 0-4)
- ✅ Created 17 labels for categorization
- ✅ Created 30 issues across 5 sprints
- ✅ Configured automation rules
- ✅ Set up CI/CD pipeline
- ✅ Prepared database schema and setup guide

**What's next:**
- Start Sprint 0 tasks
- Assign issues to team members
- Begin development on the foundation
- Track progress in the Projects board

---

**Last updated:** 2026-07-31  
**Maintainer:** @emkwambe  
**Version:** 1.0
