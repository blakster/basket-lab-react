---- MODULE FundSearchBug ----
EXTENDS Integers, FiniteSets, TLC

\* Broken sibling of FundSearch: FinishFetch applies whenever a fetch for
\* q was started, even after Dismiss aborted it (pre-a47bf2d).

CONSTANTS Q1, Q2
Queries == {Q1, Q2}

VARIABLES query, session, inflight, shown, started, locked
vars == <<query, session, inflight, shown, started, locked>>

Init ==
  /\ query = Q1
  /\ session = "idle"
  /\ inflight = {}
  /\ shown = {}
  /\ started = {}
  /\ locked = FALSE

TypeQuery(q) ==
  /\ query' = q
  /\ inflight' = {}
  /\ locked' = FALSE
  /\ session' = IF session = "dismissed" THEN "idle" ELSE session
  /\ UNCHANGED <<shown, started>>

BeginFetch(q) ==
  /\ query = q
  /\ session # "dismissed"
  /\ session' = "loading"
  /\ inflight' = {q}
  /\ started' = started \union {q}
  /\ UNCHANGED <<query, shown, locked>>

FinishFetch(q) ==
  /\ q \in started
  /\ session' = "ready"
  /\ inflight' = {}
  /\ shown' = {q}
  /\ UNCHANGED <<query, started, locked>>

FailFetch(q) ==
  /\ q \in started
  /\ session' = "error"
  /\ inflight' = {}
  /\ shown' = {}
  /\ UNCHANGED <<query, started, locked>>

Dismiss ==
  /\ session' = "dismissed"
  /\ inflight' = {}
  /\ shown' = {}
  /\ locked' = TRUE
  /\ UNCHANGED <<query, started>>

ArmFetch ==
  /\ session = "dismissed"
  /\ session' = "idle"
  /\ locked' = FALSE
  /\ UNCHANGED <<query, inflight, shown, started>>

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

DismissedStayClosed ==
  locked => shown = {}
====
