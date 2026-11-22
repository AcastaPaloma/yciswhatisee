# Demo run sheet (3 minutes)

## Before you go on (5 min)

1. `npm run tunnel`, put the tunnel URL in `.env` as `NEXT_PUBLIC_APP_URL`, then `npm run demo` (production build on http://localhost:3100; phones need this, the dev server blocks tunnel visitors).
2. Presenter opens http://localhost:3100 full screen and zooms the browser to 110–125%.
3. Three teammates sit outside with a phone or laptop and headphones. Each plays one candidate (they'll get Maya, Daniel, Noah).
4. Dry run once: Find candidates → Interview the top 3 → teammates scan the QR codes → each taps **Start interview** and answers one question → **Wrap up & decide**.
5. Click **+ New role** to reset before the real pitch.

## The pitch

| Time | Screen | Say |
|---|---|---|
| 0:00 | Requirements box | "Hiring a founding engineer takes weeks of sourcing, scheduling and back-to-back interviews. Panel does it in minutes." Click **Find candidates**. |
| 0:15 | Search animation | "It reads the role, then searches 2 billion profiles on Ploid and checks every match against public evidence." |
| 0:30 | Top 5 slides in | "Here are the five best fits, each with the evidence for why." Click **Interview the top 3**. |
| 0:40 | QR codes | "It invites the top three, and they all join at the same time, each in their own room with Ava, an ElevenLabs voice interviewer." Teammates scan and start. |
| 0:55 | Live panel | "Three interviews happening right now. Every answer is scored live, with a read on how the candidate came across." Point at sentiment tags and insights. |
| 1:30 | Orange pivot banner | **The key moment:** "All three just gave equally strong answers, so that question stopped telling them apart. Panel swapped it in every room for a harder one. You can't do that when interviews happen one after another." |
| 2:15 | **Wrap up & decide** | "It compares every answer across the rooms and picks the best candidate, with the reasons." Point at time saved. |
| 2:40 | **Send offer letter** | "And it sends the offer. If someone says no, it moves to the next person until the role is filled." |

## If something goes wrong

- **A teammate can't join or their mic fails:** click **Simulate** on that room. A second ElevenLabs agent plays the candidate from their Ploid profile.
- **Nobody is outside:** click **Simulate all with AI candidates**. All three rooms run on their own in about a minute.
- **Wi-Fi drops mid-demo:** reopen the dashboard with **Resume last run**. State is saved in `.data/`.
- **No pivot happened yet:** keep talking for one more answer. The panel swaps a question as soon as two candidates are within one point of each other on a criterion.

## Trailer cut (2-minute video)

Record the screen with **Simulate all** (fast and repeatable), then cut:
1. Typing in the requirements box → search counter → top 5 sliding in.
2. QR codes → three rooms going live.
3. Close-up on the orange "Panel changed the question in every room" banner and a room card flashing "New question from the panel".
4. Insights feed scrolling (sentiment and observations).
5. Winner card with time saved → offer accepted.
Add a short voice clip from one real room (open a room link yourself and answer) to show it's really voice.
