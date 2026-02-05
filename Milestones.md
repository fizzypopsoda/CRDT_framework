# Milestone 1

## 1. Implementation Overview
I have successfully implemented a deterministic A/B testing infrastructure within the CRDT framework. This system allows for persistent user bucketing and server-side tracking of user behavior without interfering with the core CRDT logic.

### Core Components:
* tests.json: A central configuration file located in the root directory that defines active experiments, their variants, and traffic weights.
* abTesting.ts Middleware:
    * Assignment: Uses a stable MD5 hashing algorithm combining the userId and experimentId to ensure "sticky" variant assignment (the user sees the same variant every time they return).
    * Exposure Logging: Captures a log entry when a user first connects and is assigned to a test group.
    * Event Logging: Captures a log entry every time a user successfully performs a "target action"-in this case, placing a pixel via the CRDT.

## 2. Technical Challenges & Solutions
I had a few small challenges.
- Adding a custom cas_user property to the Express session caused TS2339 errors because the property was not defined 
in the standard express-session types.
Solution: I implemented Declaration Merging by using `declare module "express-session"` to extend the SessionData
interface.
CAS Authorization in Local Development
Challenge: Yale CAS authentication restricts service redirects to registered domains, thus preventing local testing on 
localhost.
Solution: I implemented an AUTH_MODE toggle. By setting AUTH_MODE=disabled, I created a development bypass that 
- simulates a logged-in user with a persistent ID, allowing me to verify the A/B testing logic locally without 
requiring Yale's live CAS servers.

## 3. Verification of Results
The infrastructure was verified by monitoring the server-side logs during active sessions.
* Exposure Log: [AB_LOG_EXPOSURE] | User: anon-0ghj66 | Test: pixel_size_test | Variant: large - Confirmed the user was 
successfully bucketed.
* Conversion Log: [AB_LOG_EVENT] | User: anon-0ghj66 | Event: pixel_placed | Variant: large - Confirmed that actions 
are correctly attributed to the assigned variant across multiple interactions.