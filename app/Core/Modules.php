<?php
declare(strict_types=1);

namespace App\Core;

use PDO;
use RuntimeException;

/**
 * Motor CRUD genérico metadata-driven en PHP.
 *
 * Reproduce el comportamiento de server.modules.ts: todos los módulos del
 * registro comparten una única tabla (`module_records`) con la carga útil en
 * JSON, y las columnas/campos/valores por defecto provienen de
 * app/Generated/modules.json. Coacciona tipos (number/money/percent/checkbox),
 * genera códigos visibles y registra auditoría.
 */
final class Modules
{
    public function __construct(private PDO $pdo, private int $ispId = 1) {}

    // ---------------------------------------------------------------- Listado
    public function list(string $key, array $query = []): array
    {
        $module = $this->requireModule($key);
        $sql    = 'SELECT * FROM module_records WHERE module_key = ? AND isp_id = ?';
        $params = [$key, $this->ispId];

        // Filtros por campos select.
        foreach (($module['fields'] ?? []) as $field) {
            $name = (string) ($field['name'] ?? '');
            if (($field['type'] ?? '') === 'select' && isset($query[$name]) && $query[$name] !== '') {
                $sql .= ' AND JSON_UNQUOTE(JSON_EXTRACT(data, ?)) = ?';
                $params[] = '$.' . $name;
                $params[] = (string) $query[$name];
            }
        }

        // Búsqueda libre sobre los campos declarados en `search`.
        $search = trim((string) ($query['search'] ?? ''));
        if ($search !== '') {
            $like    = '%' . $search . '%';
            $clauses = [];
            foreach (($module['search'] ?? ['code']) as $field) {
                if ($field === 'code') {
                    $clauses[] = 'code LIKE ?';
                    $params[]  = $like;
                } else {
                    $clauses[] = 'JSON_UNQUOTE(JSON_EXTRACT(data, ?)) LIKE ?';
                    $params[]  = '$.' . $field;
                    $params[]  = $like;
                }
            }
            if ($clauses !== []) {
                $sql .= ' AND (' . implode(' OR ', $clauses) . ')';
            }
        }

        $limit = max(1, min(2000, (int) ($module['limit'] ?? 500)));
        $sql  .= ' ORDER BY id DESC LIMIT ' . $limit;

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);

        return array_map([$this, 'hydrate'], $stmt->fetchAll());
    }

    public function find(string $key, int $id): ?array
    {
        $this->requireModule($key);
        $stmt = $this->pdo->prepare(
            'SELECT * FROM module_records WHERE id = ? AND module_key = ? AND isp_id = ? LIMIT 1'
        );
        $stmt->execute([$id, $key, $this->ispId]);
        $row = $stmt->fetch();
        return $row ? $this->hydrate($row) : null;
    }

    public function count(string $key): int
    {
        $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM module_records WHERE module_key = ? AND isp_id = ?');
        $stmt->execute([$key, $this->ispId]);
        return (int) $stmt->fetchColumn();
    }

    // ---------------------------------------------------------------- Escritura
    public function create(string $key, array $body): array
    {
        $module = $this->requireModule($key);
        $data   = $this->coerce($module, $body, (array) ($module['defaults'] ?? []));

        $code = trim((string) ($body['code'] ?? '')) ?: $this->buildCode($module);

        $stmt = $this->pdo->prepare(
            'INSERT INTO module_records (isp_id, module_key, code, data) VALUES (?, ?, ?, ?)'
        );
        $stmt->execute([$this->ispId, $key, $code, json_encode($data, JSON_UNESCAPED_UNICODE)]);
        $id = (int) $this->pdo->lastInsertId();

        $this->appendAudit('CREATE', (string) ($module['label'] ?? $key), $code, 'Registro creado.');

        return $this->find($key, $id) ?? [];
    }

    public function update(string $key, int $id, array $body): ?array
    {
        $module   = $this->requireModule($key);
        $existing = $this->find($key, $id);
        if ($existing === null) {
            return null;
        }

        $base = $existing;
        unset($base['id'], $base['isp_id'], $base['created_at'], $base['updated_at']);
        $data = $this->coerce($module, $body, $base);

        $code = trim((string) ($body['code'] ?? ($existing['code'] ?? '')));

        $stmt = $this->pdo->prepare(
            'UPDATE module_records SET code = ?, data = ? WHERE id = ? AND module_key = ? AND isp_id = ?'
        );
        $stmt->execute([$code, json_encode($data, JSON_UNESCAPED_UNICODE), $id, $key, $this->ispId]);

        $this->appendAudit('UPDATE', (string) ($module['label'] ?? $key), $code, 'Registro actualizado.');

        return $this->find($key, $id);
    }

    public function delete(string $key, int $id): bool
    {
        $this->requireModule($key);
        $stmt = $this->pdo->prepare('DELETE FROM module_records WHERE id = ? AND module_key = ? AND isp_id = ?');
        $stmt->execute([$id, $key, $this->ispId]);
        if ($stmt->rowCount() > 0) {
            $this->appendAudit('DELETE', $key, (string) $id, 'Registro eliminado.');
            return true;
        }
        return false;
    }

    public function bulk(string $key, string $action, array $ids, array $payload = []): int
    {
        $this->requireModule($key);
        $ids = array_values(array_filter(array_map('intval', $ids)));
        if ($ids === []) {
            return 0;
        }

        if ($action === 'delete') {
            $in   = implode(',', array_fill(0, count($ids), '?'));
            $stmt = $this->pdo->prepare(
                "DELETE FROM module_records WHERE module_key = ? AND isp_id = ? AND id IN ($in)"
            );
            $stmt->execute(array_merge([$key, $this->ispId], $ids));
            return $stmt->rowCount();
        }

        if ($action === 'update') {
            $count = 0;
            foreach ($ids as $id) {
                if ($this->update($key, $id, $payload) !== null) {
                    $count++;
                }
            }
            return $count;
        }

        return 0;
    }

    // ---------------------------------------------------------------- Interno
    private function requireModule(string $key): array
    {
        $module = ModuleRegistry::find($key);
        if ($module === null) {
            throw new RuntimeException("Módulo desconocido: {$key}", 404);
        }
        return $module;
    }

    private function coerce(array $module, array $body, array $existing = []): array
    {
        $out = $existing;
        foreach (($module['fields'] ?? []) as $field) {
            $name = (string) ($field['name'] ?? '');
            if (!array_key_exists($name, $body)) {
                continue;
            }
            $out[$name] = $this->coerceValue($field, $body[$name]);
        }
        return $out;
    }

    private function coerceValue(array $field, mixed $value): mixed
    {
        $type = (string) ($field['type'] ?? 'text');

        if (in_array($type, ['number', 'money', 'percent'], true)) {
            $num = (float) str_replace(',', '.', (string) ($value ?? 0));
            if ($type === 'number' && floor($num) === $num) {
                return (int) $num;
            }
            return $num;
        }

        if ($type === 'checkbox') {
            return in_array($value, [true, 1, '1', 'true', 'on', 'Sí', 'Si'], true) ? 1 : 0;
        }

        if (is_scalar($value) || $value === null) {
            return (string) ($value ?? '');
        }

        return $value;
    }

    private function buildCode(array $module): string
    {
        $prefix = (string) ($module['codePrefix'] ?? '');
        if ($prefix === '') {
            return '';
        }
        $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM module_records WHERE module_key = ? AND isp_id = ?');
        $stmt->execute([(string) $module['key'], $this->ispId]);
        $next = ((int) $stmt->fetchColumn()) + 1;
        return sprintf('%s-%04d', $prefix, $next);
    }

    private function hydrate(array $row): array
    {
        $data = json_decode((string) $row['data'], true);
        if (!is_array($data)) {
            $data = [];
        }
        return array_merge($data, [
            'id'         => (int) $row['id'],
            'isp_id'     => (int) $row['isp_id'],
            'code'       => $row['code'],
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
        ]);
    }

    public function appendAudit(string $action, string $moduleName, string $recordId, string $details): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO audit_events (isp_id, user_name, action, module_name, record_id, details) VALUES (?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([$this->ispId, Auth::userName(), $action, $moduleName, $recordId, $details]);
    }
}
