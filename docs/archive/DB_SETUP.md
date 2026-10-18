# Database Setup Guide

## 🗃️ Database Options

Case Explorer supports multiple database backends. Choose one based on your needs:

| Database | Type | Best For | Managed Option |
|----------|------|----------|----------------|
| PostgreSQL | SQL | Production | Supabase, Neon, AWS RDS |
| SQLite | File | Local Dev | N/A |

---

## 🏗️ Option 1: Local PostgreSQL (Recommended for Development)

### **Prerequisites**
- Docker (recommended) OR PostgreSQL installed locally
- Node.js 20+

### **🐳 Using Docker (Easiest)**

#### 1. Start PostgreSQL Container
```bash
# Start PostgreSQL 15 with default credentials
docker run --name case-explorer-db \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=case_explorer \
  -p 5432:5432 \
  -d postgres:15-alpine

# Verify it's running
docker ps
```

#### 2. Connect to Database
```bash
# Using psql (if installed)
psql -h localhost -U postgres -d case_explorer

# Or using docker exec
docker exec -it case-explorer-db psql -U postgres -d case_explorer
```

#### 3. Create Schema
```bash
# Run the schema SQL file
psql -h localhost -U postgres -d case_explorer -f docs/db/schema.sql
```

#### 4. Configure Environment Variables
Create `.env` file in project root:
```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=case_explorer
DB_USER=postgres
DB_PASSWORD=postgres
```

#### 5. Test Connection
```bash
# Install pg if not already installed
npm install pg

# Test connection with a simple script
node -e "const { Pool } = require('pg'); const pool = new Pool(); pool.query('SELECT NOW()').then(console.log).catch(console.error);"
```

---

### **💻 Without Docker (Direct Install)**

#### **macOS (Homebrew)**
```bash
# Install PostgreSQL
brew install postgresql@15

# Start service
brew services start postgresql@15

# Create user and database
createuser -s postgres
createdb case_explorer
psql -U postgres -d case_explorer -f docs/db/schema.sql
```

#### **Linux (Ubuntu/Debian)**
```bash
# Install PostgreSQL
sudo apt update
sudo apt install postgresql-15 postgresql-contrib

# Start service
sudo service postgresql start

# Switch to postgres user and create database
sudo -u postgres psql -c "CREATE DATABASE case_explorer;"
sudo -u postgres psql -d case_explorer -f docs/db/schema.sql

# Create application user
sudo -u postgres psql -c "CREATE USER app_user WITH PASSWORD 'securepassword';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE case_explorer TO app_user;"
```

#### **Windows**
1. Download PostgreSQL installer from https://www.postgresql.org/download/windows/
2. Run installer with default settings
3. Use pgAdmin to create `case_explorer` database
4. Run `docs/db/schema.sql` in pgAdmin query tool

---

## ☁️ Option 2: Cloud PostgreSQL (Recommended for Production)

### **🔹 Supabase (Free Tier Available)**

#### 1. Create Supabase Project
1. Go to https://supabase.com/ and sign up
2. Click "New Project"
3. Fill in project details:
   - Project name: `case-explorer`
   - Database password: (set a strong password)
   - Region: Choose closest to you
4. Click "Create new project"
5. Wait ~2-3 minutes for database to provision

#### 2. Get Connection String
1. Go to Project → Database → Connection Settings
2. Find "Connection string" section
3. Copy the URI (format: `postgresql://postgres:[password]@[host]:[port]/postgres`)

#### 3. Configure Environment Variables
```bash
# From Supabase dashboard
echo "DB_HOST=[your-project-ref].supabase.co" >> .env
echo "DB_PORT=5432" >> .env
echo "DB_NAME=postgres" >> .env
echo "DB_USER=postgres" >> .env
echo "DB_PASSWORD=[your-password]" >> .env
```

#### 4. Run Schema Migrations
```bash
# Connect and create schema
psql -h [your-project-ref].supabase.co -U postgres -d postgres -f docs/db/schema.sql
```

#### 5. Configure Row Level Security (RLS)
```sql
-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;

-- Create policies for your application
-- (Add these based on your authentication strategy)
```

---

### **🔹 Neon.tech (Serverless PostgreSQL)**

#### 1. Create Neon Project
1. Go to https://neon.tech/ and sign up
2. Click "Create Project"
3. Fill in project details
4. Wait for provisioning

#### 2. Get Connection String
1. Go to Project → Connection Settings
2. Copy the connection URI
3. Note: Neon uses connection pooling, so use the pooled connection string

#### 3. Configure Environment Variables
```bash
echo "DB_HOST=[your-project].us-east-1.aws.neon.tech" >> .env
echo "DB_PORT=5432" >> .env
echo "DB_NAME=[your-db-name]" >> .env
echo "DB_USER=[your-db-user]" >> .env
echo "DB_PASSWORD=[your-password]" >> .env
```

#### 4. Run Schema Migrations
```bash
psql -h [your-project].us-east-1.aws.neon.tech -U [your-db-user] -d [your-db-name] -f docs/db/schema.sql
```

---

## 📜 PostgreSQL Schema

The schema is defined in `docs/db/schema.sql`. It includes:

- **users** - Application users
- **api_keys** - API authentication keys
- **datasets** - Case datasets
- **cases** - Individual generated cases
- **indexes** - Performance indexes

### **Schema File Location**
📁 `docs/db/schema.sql`

### **Generate Schema SQL**

If you need to generate the schema from scratch, run:

```bash
# This will create the schema.sql file
node docs/db/generate_schema.js
```

---

## 🔧 Configuration

### **Environment Variables**

Create `.env` file in project root:

```bash
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=case_explorer
DB_USER=postgres
DB_PASSWORD=your_password_here

# Optional: Connection string (overrides individual settings)
# DATABASE_URL=postgresql://postgres:password@localhost:5432/case_explorer

# Pool Configuration
DB_MAX_POOL_SIZE=20
DB_IDLE_TIMEOUT=30000
DB_CONNECTION_TIMEOUT=5000

# Redis (optional, for caching)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

### **Example `.env.example`**

```bash
# Copy this to .env and fill in your values
DB_HOST=
DB_PORT=5432
DB_NAME=case_explorer
DB_USER=postgres
DB_PASSWORD=

# Optional settings
DB_MAX_POOL_SIZE=20
REDIS_HOST=
REDIS_PORT=6379
```

---

## 🧪 Testing Database Connection

### **Test with Node.js**

```javascript
// test-db.js
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'case_explorer',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function testConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    console.log('✅ Database connection successful!');
    console.log('Current time:', result.rows[0].now);
    client.release();
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
}

testConnection();
```

Run with:
```bash
node test-db.js
```

---

## 🔄 Migrations

Case Explorer uses a simple migration system. Schema changes should be:

1. **Additive**: Only add new tables/columns, don't modify existing ones
2. **Backward Compatible**: Old code should work with new schema
3. **Versioned**: Each change is in a separate SQL file

### **Migration Files**

Store migrations in:
```
docs/db/migrations/
  001_initial_schema.sql
  002_add_indexes.sql
  003_add_column_x.sql
```

### **Apply Migrations**

```bash
# Run all migrations in order
for file in docs/db/migrations/*.sql; do
  psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f "$file"
done
```

---

## 📊 Database Diagram

```mermaid
erDiagram
    USERS ||--o{ API_KEYS : has
    USERS ||--o{ DATASETS : owns
    DATASETS ||--o{ CASES : contains

    USERS {
        uuid id PK
        string email UK
        string name
        string password_hash
        timestamp created_at
        timestamp updated_at
        timestamp last_login_at
        boolean is_active
        string role
    }

    API_KEYS {
        uuid id PK
        uuid user_id FK
        string key_hash ""hashed API key""
        string name
        string tier ""free|pro|enterprise""
        int rate_limit_per_hour
        int requests_this_hour
        timestamp last_request_at
        timestamp created_at
        timestamp expires_at
        boolean is_active
    }

    DATASETS {
        uuid id PK
        uuid user_id FK
        string name
        text description
        json config
        timestamp created_at
        timestamp updated_at
        int case_count
        string visibility ""private|shared|public""
    }

    CASES {
        uuid id PK
        uuid dataset_id FK
        uuid user_id FK
        string seed
        json truth
        json presentation
        json evidence
        json alignment_findings
        json ground_truth_findings
        json label
        json application_metadata
        string loan_type
        int version
        timestamp created_at
        string status
    }
```

---

## 🚀 Production Recommendations

### **Connection Pooling**
```javascript
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30s
  connectionTimeoutMillis: 5000, // Return an error after 5s if connection could not be established
});
```

### **Connection String Format**
```
postgresql://username:password@host:port/database
```

### **SSL for Cloud Databases**
For Supabase, Neon, and other cloud providers, enable SSL:
```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // For self-signed certs
    // OR for Supabase/Neon:
    // ssl: { rejectUnauthorized: true }
  }
});
```

### **Supabase SSL Configuration**
```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: true
  }
});
```

---

## 🐛 Troubleshooting

### **Connection Refused**
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```
- **Solution**: PostgreSQL is not running. Start it:
  ```bash
  # Docker
  docker start case-explorer-db
  
  # macOS (Homebrew)
  brew services start postgresql@15
  
  # Linux
  sudo service postgresql start
  ```

### **Authentication Failed**
```
Error: password authentication failed for user "postgres"
```
- **Solution**: Wrong password. Reset it:
  ```bash
  # Docker
  docker exec -it case-explorer-db psql -U postgres -c "ALTER USER postgres WITH PASSWORD 'newpassword';"
  
  # Direct install
  psql -U postgres -c "ALTER USER postgres WITH PASSWORD 'newpassword';"
  ```

### **Database Does Not Exist**
```
Error: database "case_explorer" does not exist
```
- **Solution**: Create the database:
  ```bash
  psql -U postgres -c "CREATE DATABASE case_explorer;"
  ```

### **Permission Denied**
```
Error: permission denied for schema public
```
- **Solution**: Grant permissions:
  ```bash
  psql -U postgres -d case_explorer -c "GRANT ALL ON SCHEMA public TO postgres;"
  ```

---

## 📚 Additional Resources

- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [pg (Node.js PostgreSQL client)](https://node-postgres.com/)
- [Supabase Documentation](https://supabase.com/docs)
- [Neon Documentation](https://neon.tech/docs)
- [SQL Style Guide](https://www.sqlstyle.guide/)

---

## 🔒 Security Best Practices

1. **Never commit `.env` files** - Add to `.gitignore`
2. **Use strong passwords** - Minimum 16 characters, mixed case, numbers, symbols
3. **Limit database user permissions** - Only grant necessary privileges
4. **Enable SSL** - Always use SSL for cloud databases
5. **Rotate credentials** - Change passwords regularly
6. **Use connection pooling** - Prevents connection leaks
7. **Validate all inputs** - Prevent SQL injection
8. **Use parameterized queries** - Never concatenate SQL strings

---

*Last updated: 2026-07-31*
*Maintainer: @emkwambe*
