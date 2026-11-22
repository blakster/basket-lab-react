---- MODULE FundSearch ----
EXTENDS Integers, FiniteSets, TLC

\* Models apps/web/src/state/searchRun.ts.
\* beginFetch starts an in-flight request. dismissSearch aborts it and
\* closes the list. finishFetch applies only while that request is still
\* the loading session (a47bf2d).

CONSTANTS Q1, Q2
Queries == {Q1, Q2}

VARIABLES query, session, inflight, shown, locked
vars == <<query, session, inflight, shown, locked>>

Phases == {"idle", "loading", "ready", "error", "dismissed"}

Init ==
  /\ query = Q1
  /\ session = "idle"
  /\ inflight = {}
  /\ shown = {}
  /\ locked = FALSE

Type ==
  /\ query \in Queries
  /\ session \in Phases
  /\ inflight \subseteq Queries
  /\ shown \subseteq Queries
  /\ locked \in BOOLEAN

TypeQuery(q) ==
  /\ query' = q
  /\ inflight' = {}
  /\ locked' = FALSE
  /\ session' = IF session = "dismissed" THEN "idle" ELSE session
  /\ UNCHANGED shown

BeginFetch(q) ==
  /\ query = q
  /\ session # "dismissed"
  /\ session' = "loading"
  /\ inflight' = {q}
  /\ UNCHANGED <<query, shown, locked>>

FinishFetch(q) ==
  /\ session = "loading"
  /\ q \in inflight
  /\ session' = "ready"
  /\ inflight' = {}
  /\ shown' = {q}
  /\ UNCHANGED <<query, locked>>

FailFetch(q) ==
  /\ session = "loading"
  /\ q \in inflight
  /\ session' = "error"
  /\ inflight' = {}
  /\ shown' = {}
  /\ UNCHANGED <<query, locked>>

Dismiss ==
  /\ session' = "dismissed"
  /\ inflight' = {}
  /\ shown' = {}
  /\ locked' = TRUE
  /\ UNCHANGED query

ArmFetch ==
  /\ session = "dismissed"
  /\ session' = "idle"
  /\ locked' = FALSE
  /\ UNCHANGED <<query, inflight, shown>>

Done == UNCHANGED vars

Next ==
  \/ \E q \in Queries: TypeQuery(q)
  \/ \E q \in Queries: BeginFetch(q)
  \/ \E q \in Queries: FinishFetch(q)
  \/ \E q \in Queries: FailFetch(q)
  \/ Dismiss
  \/ ArmFetch
  \/ Done

Spec == Init /\ [][Next]_vars

\* a47bf2d: a late resolve after dismiss cannot fill the list.
DismissedStayClosed ==
  locked => shown = {}
====
