# ClinicFlow module dependency rule

```text
Identity / Clinic
       ↓
Patients     Scheduling
       \       /
       Appointments
            ↓
          Visits
            ↓
         Payments

Appointments + Visits
        ↓
     Follow-ups
        ↓
     Messaging

Reporting → read across modules
Audit     ← receives records from modules
```

Rules:

- Patient code never imports appointment business services.
- Payment code never mutates Visit state directly.
- Reporting is read-only.
- HTTP routers do not contain domain workflows.
- Application services own business transactions.
- Cross-module writes occur through explicit services, not ad-hoc repository access.
