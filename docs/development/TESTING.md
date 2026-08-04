# Testing Guide - Maktab Management System

This document provides comprehensive information about the testing strategy, setup, and execution for the Maktab Management System.

## 📋 Table of Contents

- [Overview](#overview)
- [Testing Strategy](#testing-strategy)
- [Test Environment Setup](#test-environment-setup)
- [Running Tests](#running-tests)
- [Test Structure](#test-structure)
- [Writing Tests](#writing-tests)
- [Coverage Requirements](#coverage-requirements)
- [Continuous Integration](#continuous-integration)
- [Troubleshooting](#troubleshooting)

## 🎯 Overview

The Maktab Management System employs a comprehensive testing strategy covering:

- **Unit Tests**: Testing individual components and functions
- **Integration Tests**: Testing API endpoints and database interactions
- **E2E Tests**: Testing complete user workflows
- **Performance Tests**: Testing system performance under load
- **Security Tests**: Testing for vulnerabilities and security issues

## 🏗️ Testing Strategy

### Backend Testing

1. **Model Tests**: Validation, relationships, and business logic
2. **Controller Tests**: API endpoint functionality and error handling
3. **Middleware Tests**: Authentication, authorization, and request processing
4. **Service Tests**: Business logic and external service integration
5. **E2E Tests**: Complete API workflows

### Frontend Testing

1. **Component Tests**: UI component behavior and rendering
2. **Service Tests**: API communication and data handling
3. **Store Tests**: State management functionality
4. **Hook Tests**: Custom React hook behavior
5. **Integration Tests**: Component interaction and data flow

### Test Categories

- **Unit Tests**: Fast, isolated tests for individual functions
- **Integration Tests**: Tests that involve multiple components
- **E2E Tests**: End-to-end user workflow testing
- **Performance Tests**: Load and stress testing
- **Security Tests**: Vulnerability and security testing

## 🔧 Test Environment Setup

### Prerequisites

```bash
# Required software
- Node.js 18.x or higher
- Docker and Docker Compose
- PostgreSQL (for local testing)
- Redis (for caching tests)
```

### Database Setup

```bash
# Start test database
docker-compose -f docker-compose.dev.yml up -d postgres redis

# Run migrations for test database
cd backend
npm run db:migrate
cd ..
```

### Environment Variables

Create test-specific environment files:

```bash
# Backend test environment
cp backend/.env.example backend/.env.test

# Frontend test environment
cp frontend/.env.local.example frontend/.env.test
```

## 🚀 Running Tests

### Quick Start

```bash
# Run all tests
npm run test

# Run specific test suites
npm run test:backend
npm run test:frontend
npm run test:e2e

# Run with coverage
npm run test:coverage
```

### Using the Test Script

```bash
# Run comprehensive test suite
./scripts/test.sh

# Run specific test categories
./scripts/test.sh --backend
./scripts/test.sh --frontend
./scripts/test.sh --e2e
./scripts/test.sh --performance

# Skip database setup (if already running)
./scripts/test.sh --skip-setup
```

### Backend Tests

```bash
cd backend

# Unit tests
npm run test

# Watch mode for development
npm run test:watch

# Integration tests
npm run test -- --testPathPattern=controllers

# E2E tests
npm run test:e2e

# Performance tests
npm run test -- --testPathPattern=performance

# Coverage report
npm run test:coverage
```

### Frontend Tests

```bash
cd frontend

# Unit tests
npm run test

# Watch mode for development
npm run test:watch

# Coverage report
npm run test:coverage

# Type checking
npm run type-check
```

## 📁 Test Structure

### Backend Test Structure

```
backend/src/__tests__/
├── setup.ts                 # Test setup and utilities
├── models/                  # Model tests
│   ├── Tenant.test.ts
│   ├── Student.test.ts
│   └── User.test.ts
├── controllers/             # Controller tests
│   ├── AuthController.test.ts
│   └── StudentController.test.ts
├── middleware/              # Middleware tests
│   ├── authMiddleware.test.ts
│   └── tenantMiddleware.test.ts
├── services/                # Service tests
│   └── WhatsAppService.test.ts
├── e2e/                     # End-to-end tests
│   └── auth-workflow.e2e.test.ts
├── performance/             # Performance tests
│   └── load.test.ts
└── utils/                   # Test utilities
    └── testHelpers.ts
```

### Frontend Test Structure

```
frontend/src/__tests__/
├── components/              # Component tests
│   └── LoginForm.test.tsx
├── services/                # Service tests
│   └── auth.test.ts
├── store/                   # Store tests
│   └── authStore.test.ts
├── hooks/                   # Hook tests
│   └── useAuth.test.ts
└── utils/                   # Utility tests
    └── validators.test.ts
```

## ✍️ Writing Tests

### Backend Test Example

```typescript
// Model Test Example
describe('Student Model', () => {
  let tenantId: string;

  beforeEach(async () => {
    const tenant = await createTestTenant();
    tenantId = tenant.id;
  });

  it('should create a student with required fields', async () => {
    const studentData = {
      tenantId,
      admissionNumber: 'STU001',
      firstName: 'Test',
      lastName: 'Student',
      dateOfBirth: new Date('2015-08-15'),
      gender: Gender.MALE,
      admissionDate: new Date(),
    };

    const student = await Student.query().insert(studentData);

    expect(student.id).toBeDefined();
    expect(student.admissionNumber).toBe(studentData.admissionNumber);
    expect(student.status).toBe(StudentStatus.ACTIVE);
  });
});

// Controller Test Example
describe('AuthController', () => {
  it('should login successfully with valid credentials', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: '<password>',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.token).toBeDefined();
  });
});
```

### Frontend Test Example

```typescript
// Component Test Example
describe('Login Component', () => {
  it('should render login form', () => {
    render(<Login />);

    expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('should handle successful login', async () => {
    mockAuthService.login.mockResolvedValueOnce({
      user: mockUser,
      token: mockToken,
    });

    render(<Login />);

    fireEvent.change(screen.getByLabelText('Email Address'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: '<password>' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(mockAuthService.login).toHaveBeenCalled();
    });
  });
});
```

### Test Utilities

```typescript
// Test Helper Functions
export class TestDataGenerator {
  static generateEmail(prefix = 'test'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}@example.com`;
  }

  static generateTenantData(overrides = {}) {
    return {
      name: 'Test Maktab Institution',
      subdomain: this.generateSubdomain(),
      contactEmail: this.generateEmail('tenant'),
      ...overrides,
    };
  }
}

// Custom Jest Matchers
expect.extend({
  toBeValidUUID: (received: string) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const pass = uuidRegex.test(received);
    return {
      message: () => `expected ${received} ${pass ? 'not ' : ''}to be a valid UUID`,
      pass,
    };
  },
});
```

## 📊 Coverage Requirements

### Minimum Coverage Thresholds

```javascript
// jest.config.js
module.exports = {
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/database/migrations/**',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
```

### Coverage Reports

```bash
# Generate coverage reports
npm run test:coverage

# View coverage reports
open backend/coverage/lcov-report/index.html
open frontend/coverage/lcov-report/index.html
```

## 🔄 Continuous Integration

### GitHub Actions Workflow

```yaml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run backend tests
        run: npm run test:backend

      - name: Run frontend tests
        run: npm run test:frontend

      - name: Upload coverage reports
        uses: codecov/codecov-action@v3
```

## 🛠️ Troubleshooting

### Common Issues

#### Database Connection Issues

```bash
# Reset test database
docker-compose -f docker-compose.dev.yml down
docker-compose -f docker-compose.dev.yml up -d postgres

# Wait for database to be ready
./scripts/wait-for-postgres.sh
```

#### Test Timeout Issues

```javascript
// Increase timeout for slow tests
describe('Slow tests', () => {
  jest.setTimeout(30000); // 30 seconds

  it('should handle long-running operation', async () => {
    // Test code
  });
});
```

#### Memory Issues

```bash
# Increase Node.js memory limit
NODE_OPTIONS="--max-old-space-size=4096" npm run test
```

#### Port Conflicts

```bash
# Check for port usage
lsof -i :3000
lsof -i :5432

# Kill processes if needed
kill -9 <PID>
```

### Test Debugging

```javascript
// Debug specific tests
npm run test -- --verbose --no-coverage --testNamePattern="should login"

// Debug with Node.js inspector
node --inspect-brk node_modules/.bin/jest --runInBand

// Enable debug logging
DEBUG=test:* npm run test
```

### Performance Issues

```bash
# Run tests in parallel
npm run test -- --maxWorkers=4

# Run specific test files
npm run test -- path/to/specific.test.ts

# Skip slow tests during development
npm run test -- --testPathIgnorePatterns=e2e
```

## 📚 Best Practices

### Writing Effective Tests

1. **Use descriptive test names** that explain what is being tested
2. **Follow the AAA pattern**: Arrange, Act, Assert
3. **Keep tests independent** and avoid shared state
4. **Use meaningful assertions** with clear error messages
5. **Mock external dependencies** appropriately

### Test Organization

1. **Group related tests** using `describe` blocks
2. **Use `beforeEach` and `afterEach`** for setup and cleanup
3. **Create reusable test utilities** for common operations
4. **Separate unit, integration, and E2E tests**

### Performance Considerations

1. **Use database transactions** for test isolation
2. **Clean up resources** after tests complete
3. **Avoid unnecessary database queries** in tests
4. **Use mocks for external services**

### Debugging Tips

1. **Use `console.log`** sparingly for debugging
2. **Leverage IDE debugging** tools when available
3. **Run tests in isolation** to identify issues
4. **Check test setup and teardown** for problems

---

For additional help with testing, please refer to the main [README.md](../README.md) or create an issue in the project repository.