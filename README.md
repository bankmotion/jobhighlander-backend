# JobHighLander — Backend

Express + TypeScript + Prisma API over the shared MySQL/MariaDB database.
Prisma owns the schema and migrations; the Python scraper writes into the same
`jobs` table, and this API serves it to the Next.js frontend.

## Setup

```bash
npm install
npm run prisma:generate       # generate the Prisma client
npm run prisma:migrate        # create/apply the jobs table (dev)
npm run dev                   # start on http://localhost:4000
```

`.env` points `DATABASE_URL` at the local XAMPP MariaDB:
`mysql://root:@localhost:3306/jobhighlander`.

## Endpoints

| Method | Path                | Description                                  |
| ------ | ------------------- | -------------------------------------------- |
| GET    | `/health`           | Liveness check                               |
| GET    | `/api/jobs`         | List jobs — `?site=&location=&q=&page=&pageSize=` |
| GET    | `/api/jobs/filters` | Distinct sites & locations for UI dropdowns  |
| GET    | `/api/jobs/:id`     | Single job by id                             |

## Scripts

- `npm run dev` — watch mode (tsx)
- `npm run build` / `npm start` — compile to `dist/` and run
- `npm run prisma:studio` — browse the DB
- `npm run typecheck` — type-check without emitting
