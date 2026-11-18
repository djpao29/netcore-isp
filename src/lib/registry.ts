// Reexporta el registro de módulos compartido (fuente única de verdad) para el frontend.
import { GROUP_ORDER, MODULE_MAP, MODULE_REGISTRY, statusTone, nextId, buildCode } from '../../shared/modules';
import type { ColumnDef, FieldDef, FieldType, ColumnType, GroupName, ModuleDef, IntegrationKind } from '../../shared/modules';

export { GROUP_ORDER, MODULE_MAP, MODULE_REGISTRY, statusTone, nextId, buildCode };
export type { ColumnDef, FieldDef, FieldType, ColumnType, GroupName, ModuleDef, IntegrationKind };
