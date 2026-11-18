<?php
declare(strict_types=1);

namespace App\Drivers\Mikrotik;

use RuntimeException;
use InvalidArgumentException;

/**
 * Driver para gestión de tráfico MikroTik: Simple Queues, PCQ, Address Lists
 * Wrapper sobre RouterOSApiDriver para control de ancho de banda
 */
final class MikrotikTrafficDriver
{
    private RouterOSApiDriver $driver;

    public function __construct(array $router)
    {
        $this->driver = new RouterOSApiDriver(
            (string) ($router['ip_address'] ?? ''),
            (int) ($router['api_port'] ?? 8728),
            (string) ($router['username'] ?? 'admin'),
            (string) ($router['password'] ?? ''),
            (bool) ($router['use_tls'] ?? false)
        );
    }

    public function getDriver(): RouterOSApiDriver
    {
        return $this->driver;
    }

    // ============================================================
    // SIMPLE QUEUES
    // ============================================================

    /**
     * Crea una Simple Queue
     */
    public function createSimpleQueue(array $params): bool
    {
        $required = ['name', 'target', 'max_limit_up', 'max_limit_down'];
        foreach ($required as $field) {
            if (empty($params[$field])) {
                throw new InvalidArgumentException("Campo obligatorio: {$field}");
            }
        }

        $args = [
            '=name=' . $params['name'],
            '=target=' . $params['target'],
            '=dst=' . ($params['dst'] ?? '0.0.0.0/0'),
            '=max-limit=' . $params['max_limit_up'] . '/' . $params['max_limit_down'],
        ];

        // Parámetros opcionales
        if (!empty($params['burst_limit'])) {
            $args[] = '=burst-limit=' . $params['burst_limit'];
        }
        if (!empty($params['burst_threshold'])) {
            $args[] = '=burst-threshold=' . $params['burst_threshold'];
        }
        if (!empty($params['burst_time'])) {
            $args[] = '=burst-time=' . $params['burst_time'];
        }
        if (!empty($params['priority'])) {
            $args[] = '=priority=' . $params['priority'];
        }
        if (!empty($params['queue_type'])) {
            $args[] = '=queue=' . $params['queue_type'];
        }
        if (!empty($params['parent'])) {
            $args[] = '=parent=' . $params['parent'];
        }
        if (!empty($params['comment'])) {
            $args[] = '=comment=' . $params['comment'];
        }

        $this->driver->command('/queue/simple/add', $args);
        return true;
    }

    /**
     * Actualiza una Simple Queue existente
     */
    public function updateSimpleQueue(string $name, array $params): bool
    {
        $args = ['=numbers=' . $name];

        $map = [
            'target'         => '=target=',
            'dst'            => '=dst=',
            'max_limit_up'   => '=max-limit=',
            'max_limit_down' => '', // se combina con up
            'burst_limit'    => '=burst-limit=',
            'burst_threshold'=> '=burst-threshold=',
            'burst_time'     => '=burst-time=',
            'priority'       => '=priority=',
            'queue_type'     => '=queue=',
            'parent'         => '=parent=',
            'comment'        => '=comment=',
        ];

        // Manejar max-limit combinado (up/down)
        if (isset($params['max_limit_up']) || isset($params['max_limit_down'])) {
            $up = $params['max_limit_up'] ?? '';
            $down = $params['max_limit_down'] ?? '';
            if ($up !== '' && $down !== '') {
                $args[] = '=max-limit=' . $up . '/' . $down;
            }
        }

        foreach ($map as $key => $prefix) {
            if (isset($params[$key]) && $params[$key] !== '' && $prefix !== '') {
                $args[] = $prefix . $params[$key];
            }
        }

        if (isset($params['status'])) {
            $args[] = '=disabled=' . ($params['status'] === 'disabled' ? 'yes' : 'no');
        }

        $this->driver->command('/queue/simple/set', $args);
        return true;
    }

    /**
     * Elimina una Simple Queue
     */
    public function removeSimpleQueue(string $name): bool
    {
        $this->driver->command('/queue/simple/remove', ['=numbers=' . $name]);
        return true;
    }

    /**
     * Lista todas las Simple Queues
     */
    public function listSimpleQueues(): array
    {
        return $this->driver->command('/queue/simple/print');
    }

    /**
     * Obtiene una Simple Queue por nombre
     */
    public function getSimpleQueue(string $name): ?array
    {
        $queues = $this->listSimpleQueues();
        foreach ($queues as $q) {
            if (($q['name'] ?? '') === $name) {
                return $q;
            }
        }
        return null;
    }

    // ============================================================
    // PCQ QUEUES
    // ============================================================

    /**
     * Crea un perfil PCQ
     */
    public function createPcqProfile(array $params): bool
    {
        if (empty($params['name'])) {
            throw new InvalidArgumentException('Nombre del perfil PCQ requerido');
        }

        $args = [
            '=name=' . $params['name'],
            '=kind=pcq',
        ];

        if (!empty($params['rate'])) {
            $args[] = '=rate=' . $params['rate'];
        }
        if (!empty($params['pcq_classifier'])) {
            $args[] = '=pcq-classifier=' . $params['pcq_classifier'];
        }
        if (!empty($params['pcq_limit'])) {
            $args[] = '=pcq-limit=' . $params['pcq_limit'];
        }
        if (!empty($params['pcq_total_limit'])) {
            $args[] = '=pcq-total-limit=' . $params['pcq_total_limit'];
        }
        if (!empty($params['pcq_src_address'])) {
            $args[] = '=pcq-src-address=' . $params['pcq_src_address'];
        }
        if (!empty($params['pcq_dst_address'])) {
            $args[] = '=pcq-dst-address=' . $params['pcq_dst_address'];
        }

        $this->driver->command('/queue/type/add', $args);
        return true;
    }

    /**
     * Crea una Queue Tree con PCQ
     */
    public function createQueueTree(array $params): bool
    {
        $required = ['name', 'parent', 'max_limit', 'queue_type'];
        foreach ($required as $field) {
            if (empty($params[$field])) {
                throw new InvalidArgumentException("Campo obligatorio: {$field}");
            }
        }

        $args = [
            '=name=' . $params['name'],
            '=parent=' . $params['parent'],
            '=max-limit=' . $params['max_limit'],
            '=queue=' . $params['queue_type'],
        ];

        if (!empty($params['priority'])) {
            $args[] = '=priority=' . $params['priority'];
        }
        if (!empty($params['burst_limit'])) {
            $args[] = '=burst-limit=' . $params['burst_limit'];
        }
        if (!empty($params['burst_threshold'])) {
            $args[] = '=burst-threshold=' . $params['burst_threshold'];
        }
        if (!empty($params['burst_time'])) {
            $args[] = '=burst-time=' . $params['burst_time'];
        }

        $this->driver->command('/queue/tree/add', $args);
        return true;
    }

    /**
     * Lista perfiles PCQ
     */
    public function listPcqProfiles(): array
    {
        return $this->driver->command('/queue/type/print');
    }

    // ============================================================
    // ADDRESS LISTS
    // ============================================================

    /**
     * Agrega una IP a una Address List
     */
    public function addAddressListEntry(string $listName, string $address, string $comment = ''): bool
    {
        $args = [
            '=list=' . $listName,
            '=address=' . $address,
        ];
        if ($comment !== '') {
            $args[] = '=comment=' . $comment;
        }
        $this->driver->command('/ip/firewall/address-list/add', $args);
        return true;
    }

    /**
     * Remueve una IP de una Address List
     */
    public function removeAddressListEntry(string $listName, string $address): bool
    {
        // Primero buscar el .id de la entrada
        $entries = $this->driver->command('/ip/firewall/address-list/print', ['?list=' . $listName, '?address=' . $address]);
        if (!empty($entries)) {
            $id = $entries[0]['.id'] ?? '';
            if ($id !== '') {
                $this->driver->command('/ip/firewall/address-list/remove', ['=numbers=' . $id]);
                return true;
            }
        }
        return false;
    }

    /**
     * Lista todas las Address Lists
     */
    public function listAddressLists(): array
    {
        return $this->driver->command('/ip/firewall/address-list/print');
    }

    /**
     * Verifica si una IP está en una Address List
     */
    public function isInAddressList(string $listName, string $address): bool
    {
        $entries = $this->driver->command('/ip/firewall/address-list/print', ['?list=' . $listName, '?address=' . $address]);
        return !empty($entries);
    }

    // ============================================================
    // SIMPLE QUEUE + ADDRESS LIST INTEGRACIÓN (CORTE MOROSOS)
    // ============================================================

    /**
     * Aplica corte por morosidad: mueve IP a Address List MOROSOS y deshabilita Simple Queue
     */
    public function applyMorosoCut(string $pppoeUser, string $ipAddress, string $addressList = 'MOROSOS_ISP'): array
    {
        $results = [];

        // 1. Agregar IP a Address List de morosos
        $results['address_list'] = $this->addAddressListEntry($addressList, $ipAddress, "Moroso: {$pppoeUser}");

        // 2. Buscar y deshabilitar Simple Queue asociada
        $queues = $this->listSimpleQueues();
        foreach ($queues as $queue) {
            $target = $queue['target'] ?? '';
            if (str_contains($target, $ipAddress)) {
                $this->updateSimpleQueue($queue['name'], ['status' => 'disabled']);
                $results['queue_disabled'] = $queue['name'];
                break;
            }
        }

        // 3. Deshabilitar usuario PPPoE
        try {
            $this->driver->command('/ppp/secret/set', [
                '=numbers=' . $pppoeUser,
                '=disabled=yes',
            ]);
            $results['pppoe_disabled'] = true;
        } catch (\Throwable $e) {
            $results['pppoe_error'] = $e->getMessage();
        }

        // 4. Remover sesión activa PPPoE
        try {
            $active = $this->driver->command('/ppp/active/print', ['?name=' . $pppoeUser]);
            if (!empty($active)) {
                $activeId = $active[0]['.id'] ?? '';
                if ($activeId !== '') {
                    $this->driver->command('/ppp/active/remove', ['=numbers=' . $activeId]);
                    $results['session_kicked'] = true;
                }
            }
        } catch (\Throwable $e) {
            $results['session_error'] = $e->getMessage();
        }

        return $results;
    }

    /**
     * Reactiva servicio: quita de Address List, habilita Simple Queue, reactiva PPPoE
     */
    public function reactivateService(string $pppoeUser, string $ipAddress, string $addressList = 'MOROSOS_ISP', string $activeProfile = 'default'): array
    {
        $results = [];

        // 1. Remover de Address List morosos
        $results['address_list_removed'] = $this->removeAddressListEntry($addressList, $ipAddress);

        // 2. Habilitar Simple Queue
        $queues = $this->listSimpleQueues();
        foreach ($queues as $queue) {
            $target = $queue['target'] ?? '';
            if (str_contains($target, $ipAddress)) {
                $this->updateSimpleQueue($queue['name'], ['status' => 'enabled']);
                $results['queue_enabled'] = $queue['name'];
                break;
            }
        }

        // 3. Reactivar PPPoE
        try {
            $this->driver->command('/ppp/secret/set', [
                '=numbers=' . $pppoeUser,
                '=disabled=no',
                '=profile=' . $activeProfile,
            ]);
            $results['pppoe_reactivated'] = true;
        } catch (\Throwable $e) {
            $results['pppoe_error'] = $e->getMessage();
        }

        return $results;
    }
}