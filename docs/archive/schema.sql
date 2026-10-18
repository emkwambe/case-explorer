-- Case Explorer Database Schema
-- Version: 1.0.0
-- Description: PostgreSQL schema for synthetic mortgage underwriting case storage
-- Created: 2026-07-31
-- Maintainer: @emkwambe

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pgcrypto for hashing
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ============================================================================
-- USERS TABLE
-- Stores application users
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255),
    password_hash TEXT,  -- bcrypt or argon2 hash
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    role VARCHAR(50) DEFAULT 'user',  -- user, admin, super_admin
    
    -- Email verification
    email_verified BOOLEAN DEFAULT FALSE,
    email_verification_token TEXT,
    email_verification_token_expires_at TIMESTAMP WITH TIME ZONE,
    
    -- Password reset
    password_reset_token TEXT,
    password_reset_token_expires_at TIMESTAMP WITH TIME ZONE,
    
    -- Profile
    avatar_url TEXT,
    timezone VARCHAR(50) DEFAULT 'UTC',
    preferences JSONB DEFAULT '{}',
    
    -- Constraints
    CONSTRAINT valid_role CHECK (role IN ('user', 'admin', 'super_admin'))
);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);


-- ============================================================================
-- API KEYS TABLE
-- Stores API authentication keys for programmatic access
-- ============================================================================

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Key storage (only store hash, never plaintext)
    key_hash TEXT NOT NULL,  -- bcrypt hash of the API key
    key_prefix CHAR(8),  -- First 8 chars of the key for display
    
    -- Metadata
    name VARCHAR(255) NOT NULL DEFAULT 'Unnamed Key',
    description TEXT,
    tier VARCHAR(20) NOT NULL DEFAULT 'free',  -- free, pro, enterprise
    
    -- Rate limiting
    rate_limit_per_hour INTEGER NOT NULL DEFAULT 1000,
    requests_this_hour INTEGER NOT NULL DEFAULT 0,
    last_request_at TIMESTAMP WITH TIME ZONE,
    
    -- Expiration
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,  -- NULL for no expiration
    last_used_at TIMESTAMP WITH TIME ZONE,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Constraints
    CONSTRAINT valid_tier CHECK (tier IN ('free', 'pro', 'enterprise'))
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_tier ON api_keys(tier);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active) WHERE is_active = TRUE;


-- ============================================================================
-- DATASETS TABLE
-- Stores case dataset collections
-- ============================================================================

CREATE TABLE IF NOT EXISTS datasets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Metadata
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Configuration
    config JSONB NOT NULL,  -- Generation configuration
    
    -- Statistics
    case_count INTEGER NOT NULL DEFAULT 0,
    total_generation_time_ms BIGINT DEFAULT 0,
    
    -- Visibility
    visibility VARCHAR(20) NOT NULL DEFAULT 'private',  -- private, shared, public
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_visibility CHECK (visibility IN ('private', 'shared', 'public'))
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_datasets_user_id ON datasets(user_id);
CREATE INDEX IF NOT EXISTS idx_datasets_name ON datasets(name);
CREATE INDEX IF NOT EXISTS idx_datasets_visibility ON datasets(visibility);

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_datasets_updated_at
    BEFORE UPDATE ON datasets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ============================================================================
-- CASES TABLE
-- Stores individual generated mortgage cases
-- ============================================================================

CREATE TABLE IF NOT EXISTS cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dataset_id UUID REFERENCES datasets(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Generation metadata
    seed VARCHAR(255),  -- Reproducible seed
    version INTEGER NOT NULL DEFAULT 1,  -- Schema version for backward compatibility
    generation_time_ms INTEGER,  -- Time taken to generate
    
    -- Loan type (for multi-loan support)
    loan_type VARCHAR(50) NOT NULL DEFAULT 'MORTGAGE',
    
    -- Case data (stored as JSONB for flexibility)
    truth JSONB NOT NULL,
    presentation JSONB NOT NULL,
    evidence JSONB NOT NULL,
    alignment_findings JSONB NOT NULL,
    ground_truth_findings JSONB NOT NULL,
    label JSONB NOT NULL,
    application_metadata JSONB NOT NULL,
    
    -- Searchable metadata (extracted from JSON for faster queries)
    applicant_name VARCHAR(255),
    applicant_age INTEGER,
    applicant_ssn_last4 VARCHAR(4),
    applicant_zip_code VARCHAR(20),
    applicant_region VARCHAR(50),
    
    -- Financial metadata
    salary NUMERIC(12, 2),
    credit_score INTEGER,
    dti NUMERIC(5, 4),
    loan_amount NUMERIC(12, 2),
    
    -- Decision metadata
    expected_outcome VARCHAR(50),  -- APPROVE, MANUAL_REVIEW, DECLINE
    fraud_risk_level VARCHAR(50),  -- NONE, LOW, MODERATE, HIGH, CRITICAL
    alignment_level VARCHAR(10),   -- A0, A1, A2, A3, A4, A5
    case_coherence_status VARCHAR(50),  -- COHERENT, COHERENT_WITH_EXPLAINABLE_VARIANCES, INCOHERENT, FRAUDULENT
    difficulty VARCHAR(50),  -- BASIC, INTERMEDIATE, ADVANCED
    
    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'active',  -- active, archived, deleted
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_cases_dataset_id ON cases(dataset_id);
CREATE INDEX IF NOT EXISTS idx_cases_user_id ON cases(user_id);
CREATE INDEX IF NOT EXISTS idx_cases_seed ON cases(seed);
CREATE INDEX IF NOT EXISTS idx_cases_loan_type ON cases(loan_type);
CREATE INDEX IF NOT EXISTS idx_cases_created_at ON cases(created_at);
CREATE INDEX IF NOT EXISTS idx_cases_outcome ON cases(expected_outcome);
CREATE INDEX IF NOT EXISTS idx_cases_fraud_risk ON cases(fraud_risk_level);
CREATE INDEX IF NOT EXISTS idx_cases_alignment ON cases(alignment_level);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);

-- Create GIN indexes for JSONB fields (for advanced querying)
CREATE INDEX IF NOT EXISTS idx_cases_truth_gin ON cases USING GIN (truth);
CREATE INDEX IF NOT EXISTS idx_cases_presentation_gin ON cases USING GIN (presentation);

-- Create trigger to update updated_at
CREATE TRIGGER update_cases_updated_at
    BEFORE UPDATE ON cases
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ============================================================================
-- CASE SEARCH INDEX TABLE
-- Optimized table for full-text search on cases
-- ============================================================================

CREATE TABLE IF NOT EXISTS case_search_index (
    id UUID PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
    
    -- Text fields for search
    search_vector TSVECTOR,
    
    -- Numeric fields for filtering
    salary NUMERIC(12, 2),
    credit_score INTEGER,
    dti NUMERIC(5, 4),
    loan_amount NUMERIC(12, 2),
    age INTEGER,
    
    -- Categorical fields for filtering
    loan_type VARCHAR(50),
    expected_outcome VARCHAR(50),
    fraud_risk_level VARCHAR(50),
    alignment_level VARCHAR(10),
    region VARCHAR(50),
    persona VARCHAR(100),
    regime VARCHAR(50),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT fk_case_search_index CASES (id) REFERENCES cases(id)
);

-- Create GIN index on search vector
CREATE INDEX IF NOT EXISTS idx_case_search_vector ON case_search_index USING GIN(search_vector);

-- Create function to update search index
CREATE OR REPLACE FUNCTION update_case_search_index()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO case_search_index (id, search_vector, salary, credit_score, dti, loan_amount, age, loan_type, expected_outcome, fraud_risk_level, alignment_level, region, persona, regime, created_at)
    VALUES (
        NEW.id,
        to_tsvector('english', coalesce(NEW.applicant_name, '') || ' ' || 
                            coalesce(NEW.applicant_region, '') || ' ' || 
                            coalesce(NEW.persona, '') || ' ' || 
                            coalesce(NEW.regime, '')),
        NEW.salary,
        NEW.credit_score,
        NEW.dti,
        NEW.loan_amount,
        NEW.applicant_age,
        NEW.loan_type,
        NEW.expected_outcome,
        NEW.fraud_risk_level,
        NEW.alignment_level,
        NEW.applicant_region,
        (NEW.truth->>'current_state'->>'persona')::VARCHAR(100),
        (NEW.truth->>'current_state'->>'regime')::VARCHAR(50),
        NEW.created_at
    ) ON CONFLICT (id) DO UPDATE SET
        search_vector = EXCLUDED.search_vector,
        salary = EXCLUDED.salary,
        credit_score = EXCLUDED.credit_score,
        dti = EXCLUDED.dti,
        loan_amount = EXCLUDED.loan_amount,
        age = EXCLUDED.age,
        loan_type = EXCLUDED.loan_type,
        expected_outcome = EXCLUDED.expected_outcome,
        fraud_risk_level = EXCLUDED.fraud_risk_level,
        alignment_level = EXCLUDED.alignment_level,
        region = EXCLUDED.region,
        persona = EXCLUDED.persona,
        regime = EXCLUDED.regime,
        created_at = EXCLUDED.created_at;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update search index
CREATE TRIGGER trg_case_search_index
    AFTER INSERT OR UPDATE ON cases
    FOR EACH ROW
    EXECUTE FUNCTION update_case_search_index();


-- ============================================================================
-- CASE STATISTICS TABLE
-- Aggregate statistics for dashboards
-- ============================================================================

CREATE TABLE IF NOT EXISTS case_statistics (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    
    -- Counts
    cases_generated INTEGER NOT NULL DEFAULT 0,
    batch_generations INTEGER NOT NULL DEFAULT 0,
    
    -- Outcomes
    approve_count INTEGER NOT NULL DEFAULT 0,
    manual_review_count INTEGER NOT NULL DEFAULT 0,
    decline_count INTEGER NOT NULL DEFAULT 0,
    
    -- Fraud levels
    none_count INTEGER NOT NULL DEFAULT 0,
    low_count INTEGER NOT NULL DEFAULT 0,
    moderate_count INTEGER NOT NULL DEFAULT 0,
    high_count INTEGER NOT NULL DEFAULT 0,
    critical_count INTEGER NOT NULL DEFAULT 0,
    
    -- Alignment levels
    a0_count INTEGER NOT NULL DEFAULT 0,
    a1_count INTEGER NOT NULL DEFAULT 0,
    a2_count INTEGER NOT NULL DEFAULT 0,
    a3_count INTEGER NOT NULL DEFAULT 0,
    a4_count INTEGER NOT NULL DEFAULT 0,
    a5_count INTEGER NOT NULL DEFAULT 0,
    
    -- Performance
    avg_generation_time_ms NUMERIC(10, 2) DEFAULT 0,
    max_generation_time_ms INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint
    UNIQUE (date, user_id)
);

-- Create index
CREATE INDEX IF NOT EXISTS idx_case_statistics_date ON case_statistics(date);
CREATE INDEX IF NOT EXISTS idx_case_statistics_user_date ON case_statistics(user_id, date);


-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to increment case statistics
CREATE OR REPLACE FUNCTION increment_case_statistics(
    p_user_id UUID,
    p_outcome VARCHAR(50),
    p_fraud_risk VARCHAR(50),
    p_alignment_level VARCHAR(10),
    p_generation_time_ms INTEGER
) RETURNS VOID AS $$
DECLARE
    v_today DATE := CURRENT_DATE;
BEGIN
    INSERT INTO case_statistics (
        date, user_id, cases_generated, 
        approve_count, manual_review_count, decline_count,
        none_count, low_count, moderate_count, high_count, critical_count,
        a0_count, a1_count, a2_count, a3_count, a4_count, a5_count,
        avg_generation_time_ms, max_generation_time_ms
    ) VALUES (
        v_today, p_user_id, 1,
        CASE WHEN p_outcome = 'APPROVE' THEN 1 ELSE 0 END,
        CASE WHEN p_outcome = 'MANUAL_REVIEW' THEN 1 ELSE 0 END,
        CASE WHEN p_outcome = 'DECLINE' THEN 1 ELSE 0 END,
        CASE WHEN p_fraud_risk = 'NONE' THEN 1 ELSE 0 END,
        CASE WHEN p_fraud_risk = 'LOW' THEN 1 ELSE 0 END,
        CASE WHEN p_fraud_risk = 'MODERATE' THEN 1 ELSE 0 END,
        CASE WHEN p_fraud_risk = 'HIGH' THEN 1 ELSE 0 END,
        CASE WHEN p_fraud_risk = 'CRITICAL' THEN 1 ELSE 0 END,
        CASE WHEN p_alignment_level = 'A0' THEN 1 ELSE 0 END,
        CASE WHEN p_alignment_level = 'A1' THEN 1 ELSE 0 END,
        CASE WHEN p_alignment_level = 'A2' THEN 1 ELSE 0 END,
        CASE WHEN p_alignment_level = 'A3' THEN 1 ELSE 0 END,
        CASE WHEN p_alignment_level = 'A4' THEN 1 ELSE 0 END,
        CASE WHEN p_alignment_level = 'A5' THEN 1 ELSE 0 END,
        p_generation_time_ms::NUMERIC(10, 2),
        p_generation_time_ms
    ) ON CONFLICT (date, user_id) DO UPDATE SET
        cases_generated = case_statistics.cases_generated + 1,
        approve_count = case_statistics.approve_count + CASE WHEN p_outcome = 'APPROVE' THEN 1 ELSE 0 END,
        manual_review_count = case_statistics.manual_review_count + CASE WHEN p_outcome = 'MANUAL_REVIEW' THEN 1 ELSE 0 END,
        decline_count = case_statistics.decline_count + CASE WHEN p_outcome = 'DECLINE' THEN 1 ELSE 0 END,
        none_count = case_statistics.none_count + CASE WHEN p_fraud_risk = 'NONE' THEN 1 ELSE 0 END,
        low_count = case_statistics.low_count + CASE WHEN p_fraud_risk = 'LOW' THEN 1 ELSE 0 END,
        moderate_count = case_statistics.moderate_count + CASE WHEN p_fraud_risk = 'MODERATE' THEN 1 ELSE 0 END,
        high_count = case_statistics.high_count + CASE WHEN p_fraud_risk = 'HIGH' THEN 1 ELSE 0 END,
        critical_count = case_statistics.critical_count + CASE WHEN p_fraud_risk = 'CRITICAL' THEN 1 ELSE 0 END,
        a0_count = case_statistics.a0_count + CASE WHEN p_alignment_level = 'A0' THEN 1 ELSE 0 END,
        a1_count = case_statistics.a1_count + CASE WHEN p_alignment_level = 'A1' THEN 1 ELSE 0 END,
        a2_count = case_statistics.a2_count + CASE WHEN p_alignment_level = 'A2' THEN 1 ELSE 0 END,
        a3_count = case_statistics.a3_count + CASE WHEN p_alignment_level = 'A3' THEN 1 ELSE 0 END,
        a4_count = case_statistics.a4_count + CASE WHEN p_alignment_level = 'A4' THEN 1 ELSE 0 END,
        a5_count = case_statistics.a5_count + CASE WHEN p_alignment_level = 'A5' THEN 1 ELSE 0 END,
        avg_generation_time_ms = (
            (case_statistics.avg_generation_time_ms * case_statistics.cases_generated + p_generation_time_ms) / 
            (case_statistics.cases_generated + 1)
        )::NUMERIC(10, 2),
        max_generation_time_ms = GREATEST(case_statistics.max_generation_time_ms, p_generation_time_ms);
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- TRIGGERS FOR STATISTICS
-- ============================================================================

-- Trigger to update statistics when a case is inserted
CREATE OR REPLACE FUNCTION update_statistics_on_case_insert()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM increment_case_statistics(
        NEW.user_id,
        (NEW.label->>'expected_outcome')::VARCHAR(50),
        (NEW.label->>'fraud_risk_level')::VARCHAR(50),
        (NEW.label->>'alignment_level')::VARCHAR(10),
        NEW.generation_time_ms
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_stats_on_case_insert
    AFTER INSERT ON cases
    FOR EACH ROW
    EXECUTE FUNCTION update_statistics_on_case_insert();


-- ============================================================================
-- VIEWS
-- ============================================================================

-- View for user dashboard
CREATE OR REPLACE VIEW user_dashboard AS
SELECT 
    u.id AS user_id,
    u.email,
    u.name,
    COUNT(c.id) AS total_cases,
    COUNT(CASE WHEN c.created_at >= NOW() - INTERVAL '24 hours' THEN 1 END) AS cases_last_24h,
    COUNT(CASE WHEN c.created_at >= NOW() - INTERVAL '7 days' THEN 1 END) AS cases_last_7d,
    COUNT(CASE WHEN c.expected_outcome = 'APPROVE' THEN 1 END) AS approve_count,
    COUNT(CASE WHEN c.expected_outcome = 'MANUAL_REVIEW' THEN 1 END) AS manual_review_count,
    COUNT(CASE WHEN c.expected_outcome = 'DECLINE' THEN 1 END) AS decline_count,
    COUNT(CASE WHEN c.fraud_risk_level != 'NONE' THEN 1 END) AS fraud_cases,
    COUNT(CASE WHEN c.fraud_risk_level = 'HIGH' OR c.fraud_risk_level = 'CRITICAL' THEN 1 END) AS high_risk_cases,
    AVG(c.generation_time_ms) AS avg_generation_time_ms,
    MAX(c.created_at) AS last_case_created_at
FROM users u
LEFT JOIN cases c ON c.user_id = u.id
WHERE u.is_active = TRUE
GROUP BY u.id, u.email, u.name;


-- View for recent cases
CREATE OR REPLACE VIEW recent_cases AS
SELECT 
    c.id,
    c.user_id,
    u.email AS user_email,
    u.name AS user_name,
    c.seed,
    c.loan_type,
    c.expected_outcome,
    c.fraud_risk_level,
    c.alignment_level,
    c.case_coherence_status,
    c.difficulty,
    c.salary,
    c.credit_score,
    c.dti,
    c.loan_amount,
    c.applicant_age,
    c.applicant_region,
    c.created_at
FROM cases c
LEFT JOIN users u ON c.user_id = u.id
ORDER BY c.created_at DESC
LIMIT 100;


-- View for daily statistics
CREATE OR REPLACE VIEW daily_statistics AS
SELECT 
    date,
    SUM(cases_generated) AS total_cases,
    SUM(approve_count) AS total_approves,
    SUM(manual_review_count) AS total_manual_reviews,
    SUM(decline_count) AS total_declines,
    SUM(none_count + low_count + moderate_count + high_count + critical_count) AS total_with_fraud,
    SUM(high_count + critical_count) AS total_high_risk,
    AVG(avg_generation_time_ms) AS avg_generation_time
FROM case_statistics
GROUP BY date
ORDER BY date DESC;


-- ============================================================================
-- INITIAL DATA
-- ============================================================================

-- Insert admin user (password: admin123 - change this!)
-- To set password: UPDATE users SET password_hash = crypt('newpassword', gen_salt('bf')) WHERE email = 'admin@caseexplorer.com';
-- INSERT INTO users (email, name, password_hash, role, email_verified) 
-- VALUES ('admin@caseexplorer.com', 'Admin User', crypt('admin123', gen_salt('bf')), 'super_admin', TRUE);


-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE users IS 'Stores application users with authentication and profile information';
COMMENT ON TABLE api_keys IS 'Stores API keys for programmatic access with rate limiting';
COMMENT ON TABLE datasets IS 'Stores case dataset collections with configuration';
COMMENT ON TABLE cases IS 'Stores individual generated mortgage underwriting cases';
COMMENT ON TABLE case_search_index IS 'Full-text search index for cases';
COMMENT ON TABLE case_statistics IS 'Aggregate statistics for dashboards and analytics';

COMMENT ON COLUMN cases.truth IS 'Complete truth data including demographics, employment, finances, etc.';
COMMENT ON COLUMN cases.presentation IS 'Presented/applied data which may contain fraud or errors';
COMMENT ON COLUMN cases.evidence IS 'Synthetic evidence documents (W2, bank statements, etc.)';
COMMENT ON COLUMN cases.alignment_findings IS '12-dimension alignment validation results';
COMMENT ON COLUMN cases.ground_truth_findings IS 'Ground truth deltas between layers';
COMMENT ON COLUMN cases.label IS 'Decision labels and metadata';
COMMENT ON COLUMN cases.application_metadata IS 'Application submission metadata including IP, device, behavior';


-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
