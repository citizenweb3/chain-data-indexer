# Мониторинг Индексера - Prometheus, Grafana, Grafana Alloy

Индексер теперь имеет health endpoints и метрики, которые можно интегрировать с системами мониторинга.

## Доступные Endpoints

### Health Check

**aztec-listener:**
```bash
GET http://localhost:8000/health
```

**explorer-api:**
```bash
GET http://localhost:8000/health
```

**Формат ответа:**
```json
{
  "status": "healthy",
  "checks": {
    "postgres": true,
    "rpcNodes": true
  },
  "timestamp": "2025-12-16T10:30:00.123Z",
  "service": "aztec-listener"
}
```

### Metrics (Prometheus Format)

**aztec-listener:**
```bash
GET http://localhost:8000/metrics
```

**explorer-api:**
```bash
GET http://localhost:8000/metrics
```

**Формат ответа:**
```
# HELP aztec_listener_up Service is up
# TYPE aztec_listener_up gauge
aztec_listener_up 1
```

---

## Интеграция с Prometheus

### 1. Установка Prometheus

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  # Aztec Listener
  - job_name: 'aztec-listener'
    static_configs:
      - targets: ['localhost:8000']
    metrics_path: '/metrics'
    scrape_interval: 30s

  # Explorer API
  - job_name: 'explorer-api'
    static_configs:
      - targets: ['localhost:8000']
    metrics_path: '/metrics'
    scrape_interval: 30s
```

### 2. Запуск Prometheus в Docker

```bash
docker run -d \
  --name prometheus \
  -p 9090:9090 \
  -v $(pwd)/prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus
```

### 3. Проверка

Откройте http://localhost:9090 и выполните запрос:

```promql
aztec_listener_up
```

---

## Интеграция с Grafana

### 1. Запуск Grafana

```bash
docker run -d \
  --name grafana \
  -p 3000:3000 \
  grafana/grafana
```

Откройте http://localhost:3000 (логин: `admin`, пароль: `admin`)

### 2. Добавление Prometheus как Data Source

1. Перейдите в **Configuration** → **Data Sources** → **Add data source**
2. Выберите **Prometheus**
3. URL: `http://prometheus:9090` (если в одной Docker-сети) или `http://localhost:9090`
4. Нажмите **Save & Test**

### 3. Создание Dashboard

Импортируйте готовый dashboard или создайте свой:

**Примеры панелей:**

#### Uptime панель
```promql
aztec_listener_up
```

#### Health Status (если расширите метрики)
```promql
rate(http_requests_total{endpoint="/health"}[5m])
```

---

## Интеграция с Grafana Alloy

**Grafana Alloy** (ранее Grafana Agent) - упрощенный агент для сбора метрик и логов.

### 1. Установка Grafana Alloy

```bash
docker run -d \
  --name grafana-alloy \
  -v $(pwd)/alloy-config.yaml:/etc/alloy/config.yaml \
  -p 12345:12345 \
  grafana/alloy:latest
```

### 2. Конфигурация (`alloy-config.yaml`)

```yaml
prometheus.scrape "aztec_indexer" {
  targets = [
    {
      __address__ = "localhost:8000",
      job = "aztec-listener",
    },
  ]
  forward_to = [prometheus.remote_write.default.receiver]
  scrape_interval = "30s"
  metrics_path = "/metrics"
}

prometheus.remote_write "default" {
  endpoint {
    url = "https://your-grafana-cloud.grafana.net/api/prom/push"
    basic_auth {
      username = "your-username"
      password = "your-api-key"
    }
  }
}
```

### 3. Проверка работы

```bash
curl http://localhost:12345/metrics
```

---

## Health Check Monitoring с Prometheus

### Создание алертов

Добавьте в `prometheus.yml`:

```yaml
rule_files:
  - 'alerts.yml'

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['localhost:9093']
```

**Файл `alerts.yml`:**

```yaml
groups:
  - name: aztec_indexer
    interval: 30s
    rules:
      # Алерт если сервис down
      - alert: AztecListenerDown
        expr: aztec_listener_up == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Aztec Listener is down"
          description: "Aztec Listener has been down for more than 2 minutes"

      # Алерт если сервис недоступен
      - alert: AztecListenerUnhealthy
        expr: probe_success{job="aztec-listener"} == 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Aztec Listener health check failed"
          description: "Health check has been failing for 5 minutes"
```

---

## Blackbox Exporter для Health Checks

Для мониторинга HTTP health endpoints используйте Blackbox Exporter:

### 1. Запуск Blackbox Exporter

```bash
docker run -d \
  --name blackbox-exporter \
  -p 9115:9115 \
  prom/blackbox-exporter:latest
```

### 2. Конфигурация Prometheus

```yaml
scrape_configs:
  - job_name: 'blackbox'
    metrics_path: /probe
    params:
      module: [http_2xx]
    static_configs:
      - targets:
          - http://localhost:8000/health  # aztec-listener
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox-exporter:9115
```

### 3. Grafana Dashboard для Health

**Панель: Health Check Status**

```promql
probe_success{job="blackbox"}
```

- `1` = healthy
- `0` = unhealthy

**Панель: Response Time**

```promql
probe_duration_seconds{job="blackbox"}
```

---

## Полный Docker Compose с Мониторингом

```yaml
version: "3.8"

services:
  # Ваш индексер
  aztec-listener:
    # ... существующая конфигурация
    labels:
      prometheus.io/scrape: "true"
      prometheus.io/port: "8000"
      prometheus.io/path: "/metrics"

  # Prometheus
  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
      - ./monitoring/alerts.yml:/etc/prometheus/alerts.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
    restart: unless-stopped

  # Grafana
  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_USERS_ALLOW_SIGN_UP=false
    volumes:
      - grafana_data:/var/lib/grafana
      - ./monitoring/dashboards:/etc/grafana/provisioning/dashboards
      - ./monitoring/datasources:/etc/grafana/provisioning/datasources
    restart: unless-stopped

  # Blackbox Exporter
  blackbox-exporter:
    image: prom/blackbox-exporter:latest
    container_name: blackbox-exporter
    ports:
      - "9115:9115"
    restart: unless-stopped

volumes:
  prometheus_data:
  grafana_data:
```

---

## Grafana Cloud (SaaS решение)

Если используете Grafana Cloud:

### 1. Получите API ключ

1. Перейдите на https://grafana.com/
2. Создайте аккаунт
3. Получите Prometheus endpoint и API key

### 2. Настройте Grafana Alloy

```yaml
prometheus.scrape "aztec_indexer" {
  targets = [
    {__address__ = "localhost:8000", job = "aztec-listener"},
  ]
  forward_to = [prometheus.remote_write.grafana_cloud.receiver]
}

prometheus.remote_write "grafana_cloud" {
  endpoint {
    url = "https://prometheus-prod-XX-XX.grafana.net/api/prom/push"
    basic_auth {
      username = "123456"
      password = "glc_eyJrIjoiXXXXXX"
    }
  }
}
```

### 3. Просмотр метрик

Метрики будут доступны в вашем Grafana Cloud через несколько минут.

---

## Рекомендуемые Метрики для Расширения

Вы можете расширить текущий `/metrics` endpoint:

```typescript
// В health.ts
app.get("/metrics", (req, res) => {
  res.set("Content-Type", "text/plain");
  res.send(`
# HELP aztec_listener_up Service is up
# TYPE aztec_listener_up gauge
aztec_listener_up 1

# HELP aztec_listener_postgres_pool_total Total DB connections
# TYPE aztec_listener_postgres_pool_total gauge
aztec_listener_postgres_pool_total ${pool.totalCount}

# HELP aztec_listener_postgres_pool_idle Idle DB connections
# TYPE aztec_listener_postgres_pool_idle gauge
aztec_listener_postgres_pool_idle ${pool.idleCount}

# HELP aztec_listener_rpc_nodes_online Online RPC nodes
# TYPE aztec_listener_rpc_nodes_online gauge
aztec_listener_rpc_nodes_online ${getAmountOfOnlineNodes()}

# HELP aztec_listener_last_block_height Last indexed block
# TYPE aztec_listener_last_block_height gauge
aztec_listener_last_block_height ${lastBlockHeight}
  `);
});
```

---

## Резюме

✅ **Health endpoints** готовы к использованию с:
- Prometheus (scraping `/metrics`)
- Grafana (визуализация)
- Grafana Alloy (агент для Grafana Cloud)
- Blackbox Exporter (HTTP health checks)

✅ **Можно настроить:**
- Алерты при падении сервиса
- Мониторинг response time
- Дашборды с метриками индексатора
- Интеграцию с Grafana Cloud (SaaS)

Все endpoints **совместимы с Prometheus** и готовы к production использованию! 🎉
