# Nudge | Adaptive Habit Support

**Full-Stack Development · Contextual Bandits · Machine Learning · Web Push · Cloud Deployment**

Nudge is a full-stack Progressive Web Application that uses a **Linear Upper Confidence Bound (LinUCB) contextual bandit** to adapt habit-support notifications based on user activity, engagement history and contextual information.

Built using React, TypeScript, Supabase and PostgreSQL, the application combines a responsive user interface with scheduled backend processing, adaptive decision-making, push-notification delivery and reward-based learning.

Originally developed for an MSc dissertation at **Birmingham City University (BCU)**, Nudge is maintained as a technical portfolio project demonstrating full-stack engineering and applied machine learning.

## Technical Skills Demonstrated

| Area | Implementation |
|---|---|
| Frontend Engineering | React, JavaScript, Vite, responsive UI, PWA |
| Backend Engineering | TypeScript, Deno, Supabase Edge Functions |
| Database Development | PostgreSQL, relational schema design, data relationships |
| Applied Machine Learning | Contextual multi-armed bandits, LinUCB, exploration vs exploitation |
| API Integration | Supabase JavaScript client, serverless function integration |
| Background Processing | Scheduled jobs, decision pipelines, reward assignment |
| Push Notifications | Web Push API, VAPID, service workers, subscriptions |
| Reliability | Delivery status tracking, retries, expiration, eligibility checks |
| Deployment | Vercel, Supabase, Git and GitHub |

## Features

**Habit and goal management**
- Anonymous onboarding using six-character participant codes.
- Goal selection and custom goal support.
- Daily activity logging and streak tracking.
- User-configurable quiet hours and notification limits.

**Adaptive notification engine**
- Ten-dimensional contextual feature vectors.
- LinUCB-based selection across intervention strategies.
- User engagement history incorporated into future decisions.
- Cooldown periods and notification eligibility rules.
- Explicit no-message outcomes when notifications are restricted.

**Notification delivery**
- Web Push subscriptions for compatible browsers and installed PWAs.
- Supabase-backed notification queue.
- Pending, sent, failed and expired delivery states.
- Retry limits and delivery-attempt tracking.
- Separation between push-service acceptance and user engagement.

## Architecture

```text
React PWA
    |
    | User actions and API requests
    v
Supabase Edge Functions
    |
    +-- User and goal management
    +-- Activity logging
    +-- Push subscription registration
    |
    v
PostgreSQL
    |
    v
Scheduled Notification Engine
    |
    +-- Eligibility checks
    +-- Context vector generation
    +-- LinUCB strategy selection
    +-- Notification queue
    |
    v
Web Push Delivery
    |
    v
Browser Service Worker

Engagement Data
    |
    v
Reward Assignment
    |
    v
LinUCB Parameter Updates
```

The backend uses scheduled tasks to separate notification decisions, delivery, reward assignment and model updates.

## Contextual Bandit Implementation

Nudge uses a contextual multi-armed bandit to balance the exploration of notification strategies with exploitation of previously successful strategies.

The current LinUCB implementation uses ten context features:

1. Bias term
2. Hour of day
3. Day of week
4. Time since previous activity
5. Current goal streak
6. Recent response rate
7. Goal age
8. Activity logs recorded today
9. Weekend indicator
10. Quiet-hours indicator

Each intervention strategy maintains an \(A\) matrix and \(b\) vector representing accumulated learning information.

The selection score is:

\[
p_a=x^\top A_a^{-1}b_a+\alpha\sqrt{x^\top A_a^{-1}x}
\]

The exploration coefficient is configured as **0.8**.

The implementation uses explicit eligibility rules for no-message decisions. A fully learned no-message alternative remains a potential future improvement.

## Engineering Challenges

### Reliable asynchronous delivery

Notification decisions and actual delivery occur in separate processes.

The backend therefore tracks delivery lifecycle states rather than assuming that generating a notification means it was delivered.

Failed or expired pending notifications must not indefinitely prevent subsequent eligible interventions.

### Subscription management

Push delivery requires a browser subscription that is associated with the correct participant.

The decision engine checks for registered subscriptions before scheduling interventions, while the delivery service handles attempts and failures separately.

### Reward attribution

The system separates notification selection, push-service acceptance and recorded user engagement.

This distinction is important when evaluating adaptive strategies and updating the bandit model.

### Scheduled backend processing

Supabase Cron coordinates recurring decisions and learning updates without relying on the frontend being open.

## Repository Structure

```text
nudge/
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   ├── lib/
│   │   ├── pages/
│   │   └── styles/
│   ├── package.json
│   └── vite.config.js
│
├── backend/
│   ├── supabase/
│   │   ├── functions/
│   │   └── config.toml
│   └── package.json
│
├── .gitignore
└── README.md
```

## Running Locally

### Prerequisites
- Node.js and npm
- A Supabase project
- Supabase CLI
- Configured environment variables and database resources

### Frontend

```bash
cd frontend
npm ci
npm run dev
```

Production build:

```bash
npm run build
```

### Backend

The backend Edge Functions reside in `backend/supabase/functions`.

```bash
cd backend
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
```

Deploy an Edge Function:

```bash
npx supabase functions deploy decide-notification
```

**Configuration note:** A complete database migration and seed-data setup is not yet included in the repository. A new Supabase project requires additional schema, configuration and secret setup before all features can run.

Never commit Supabase service-role keys, private VAPID keys, Cron secrets or other sensitive environment variables.

## Testing and Validation

The following checks have been completed during development:

- Successful frontend production builds.
- Clean frontend dependency installation using `npm ci`.
- Dependency audit reporting zero known vulnerabilities at the time of testing.
- Successful new participant and push-subscription registration.
- Successful manual execution of the adaptive decision function.
- Successful real-device push-notification delivery.

Further automated integration testing, database provisioning and concurrency hardening are planned.

## Research Background

Nudge originated as an MSc dissertation project at **Birmingham City University**.

The project investigated adaptive notification strategies for non-clinical digital wellbeing applications, focusing on engagement rather than medical or behavioural health outcomes.

The current portfolio implementation demonstrates the engineering approach and functional system. It does not claim that adaptive reminders have been conclusively proven superior to static reminders.

## Future Improvements

- Automated tests and CI/CD verification.
- Version-controlled database migrations and seed data.
- More robust concurrency handling for notification processing.
- Improved delivery-failure monitoring.
- Local-timezone accuracy for daily notification rules.
- An analytics dashboard for model performance.
- Further evaluation of adaptive versus static strategies.

## Author

**Hassan Fatai**

Full-Stack Developer | BSc Computer Science | MSc Computer Science

## Status

**Operational prototype, under continued portfolio development.**

Core functionality has been implemented and successfully tested, with additional engineering improvements planned.
