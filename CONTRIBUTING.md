# Contributing to NetCore ISP

Thank you for your interest in contributing to NetCore ISP! This document provides guidelines for contributing to the project.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## How to Contribute

### Reporting Bugs

Before submitting a bug report:
1. Check if the issue already exists in the [issue tracker](https://github.com/your-org/netcore-isp/issues)
2. Use the bug report template
3. Include steps to reproduce, expected behavior, and actual behavior

### Suggesting Features

Feature requests are welcome! Please:
1. Check existing issues and discussions
2. Use the feature request template
2. Explain the use case and expected behavior

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests and linting (`npm run lint && php artisan test`)
5. Commit with descriptive messages
6. Push to your fork
6. Open a Pull Request

## Development Setup

### Prerequisites

- Node.js 20+
- PHP 8.2+
- MySQL 8.0+ / MariaDB 10.6+
- Composer (for PHP dependencies)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/netcore-isp.git
cd netcore-isp

# Install Node.js dependencies
npm install

# Install PHP dependencies (if using Composer)
composer install

# Copy environment file
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
php artisan migrate

# Start development server
npm run dev
```

### Development Workflow

1. Create a new branch for your feature/fix
2. Make changes
3. Run linting: `npm run lint`
4. Run tests: `npm run test` (when available)
5. Commit with conventional commits:
   - `feat: add new feature`
   - `fix: bug description`
   - `docs: update documentation`
   - `refactor: improve code structure`
   - `test: add tests`
   - `chore: maintenance tasks`
6. Push and open PR

## Coding Standards

### TypeScript / React
- Use TypeScript strict mode
- Follow React best practices
- Use functional components with hooks
- Use TypeScript interfaces for props and state
- Follow ESLint configuration

### PHP
- Follow PSR-12 coding standard
- Use strict types (`declare(strict_types=1)`)
- Use type hints and return types
- Use dependency injection
- Follow SOLID principles

### Database
- Use migrations for schema changes
- Use foreign keys for relationships
- Use appropriate data types
- Add indexes for frequently queried columns

### Git Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>[optional scope]: <description>

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Formatting, missing semicolons, etc.
- `refactor`: Code restructuring
- `test`: Adding tests
- `chore`: Maintenance tasks

Example:
```
feat(api): add customer suspension endpoint

Add POST /api/v1/customers/:id/toggle-status endpoint
to suspend/reactivate customers via MikroTik API.

Closes #123
```

## Testing

- Write unit tests for new functionality
- Run tests before committing: `npm run test`
- Aim for >80% code coverage
- Use descriptive test names

## Documentation

- Update README.md for new features
- Update API documentation for new endpoints
- Add inline comments for complex logic
- Keep CHANGELOG.md updated

## Release Process

1. Update version in package.json
2. Update CHANGELOG.md
3. Create release tag: `git tag v1.2.3`
4. Push tag: `git push origin v1.2.3`
5. GitHub Actions will create release

## Questions?

Feel free to open a discussion or contact the maintainers.

Thank you for contributing!