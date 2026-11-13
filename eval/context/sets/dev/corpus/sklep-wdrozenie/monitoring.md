# Monitoring

## Alerts that page the person on call

| Alert | Condition |
| --- | --- |
| Error rate | above 2% for 5 minutes |
| Queue depth | above 500 jobs for 10 minutes |
| Slow responses | p95 latency above 1.5 s for 10 minutes |
| Payment webhooks | no confirmation for 15 minutes during the day |

## Alerts that open a ticket

| Alert | Condition |
| --- | --- |
| Certificate expiry | 21 days ahead |
| Disk usage | above 80% |
| Warehouse import | totals differ from the previous night by more than 20% |

## Dashboards

- **Shop overview:** orders per minute, error rate, response times.
- **Queue:** depth, job duration, retries.
- **Database:** connections, replication lag, slow queries.

Alert thresholds are reviewed once a quarter.
