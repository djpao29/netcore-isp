# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-18

### Added
- **Core Architecture**: Multi-tenant WISP/FTTH management system
- **Network Inventory**: Unified management for AP, CPE, OLT, Router, PTP, Switch with GPS mapping (Leaflet/OpenStreetMap)
- **Customer Management**: 360° customer view with PPPoE lifecycle, CPE/ONU provisioning
- **Billing System**: Complete billing cycle (generation → overdue → suspension → payment → reactivation)
- **MikroTik Integration**: Real RouterOS API (binary protocol) for PPPoE, Simple Queues, PCQ, Address Lists
- **OLT/FTTH Management**: SmartOLT API integration, SNMP support for ZTE/Huawei/VSOL/FiberHome
- **FreeRADIUS Integration**: REST API for PPPoE/Hotspot/802.1X authentication
- **SmartOLT Integration**: REST API for ONU authorization, signal monitoring, reboot
- **WhatsApp Integration**: Meta Cloud API / Evolution API / UltraMsg for notifications and OCR receipts
- **Payment Gateway**: PayPal REST v2, extensible for Stripe/local gateways
- **AI Assistant**: RBAC-controlled ISP telemetry with controlled function calling (Gemini/AnyRouter)
- **Metadata-Driven Modules**: 40+ modules generated from single source of truth (shared/modules.ts)
- **Multi-tenancy**: Complete ISP isolation with configurable branding, currency, timezone
- **Role-Based Access Control**: 6 roles (SUPERADMIN, ADMIN, BILLING, SUPPORT, TECHNICIAN, COBRANZA)
- **Audit Logging**: Complete audit trail for all CRUD operations
- **Data Import/Export**: JSON multi-section and CSV entity imports with templates
- **SmartOLT OCR**: Receipt OCR processing with admin validation
- **AI Assistant**: Controlled function calling for ISP telemetry (network, overdue, billing)
- **HotSpot Management**: Voucher generation, captive portal
- **Inventory Management**: Warehouse items, suppliers, branches, movements
- **Accounting**: Expenses, income, depreciation, fiscal years, reconciliations
- **Helpdesk**: Tickets with categories, priorities, technicians, signatures
- **IPv6 Planning**: Prefix pools, assignments, DHCPv6-PD/SLAAC
- **SmartOLT/OLT Alarms**: SNMP trap monitoring
- **API Documentation**: Built-in PHP source viewer
- **Docker Support**: Multi-stage Dockerfile, docker-compose for production and development

### Changed
- **Frontend**: Fixed React syntax error in App.tsx (duplicate Excel import section)
- **TypeScript**: Fixed all strict mode errors (FreeRadiusDriver, MikrotikTrafficDriver, server.ts)
- **Frontend Build**: Vite + React 19 + TailwindCSS 4 + Motion animations
- **Backend**: Express + Vite middleware in development, static serving in production

### Fixed
- **Frontend**: Fixed duplicate Excel import section causing build failure
- **TypeScript**: Fixed implicit any types in server.ts Excel import
- **FreeRadiusDriver**: Fixed return type for testConnection()
- **MikrotikTrafficDriver**: Fixed Record<string,string> casting for address-list entries
- **Server**: Fixed implicit any types in Excel import parsing

### Security
- **Authentication**: Argon2id/Bcrypt password hashing, CSRF tokens, session management
- **Authorization**: Row-level multi-tenant isolation, RBAC permissions
- **Input Validation**: MAC/IP/GPS validation, SQL injection prevention via PDO prepared statements
- **API Security**: Rate limiting, CORS, CSP headers, Helmet.js
- **Secrets**: Environment variables for all credentials, no hardcoded secrets

## [Unreleased]

### Planned
- Mobile app (React Native / Capacitor)
- Advanced reporting with charts (Chart.js / Recharts)
- Webhook system for external integrations
- Advanced OCR with multiple providers
- Multi-language support (i18n)
- Advanced analytics dashboard
- Automated backup scheduling
- API rate limiting per tenant
- Advanced MikroTik scripting (RouterOS scripts deployment)
- OLT firmware management
- Customer self-service portal (React Native Web / PWA)