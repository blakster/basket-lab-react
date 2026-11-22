---- MODULE EnsureFilingsBug ----
EXTENDS Integers, FiniteSets, Sequences, TLC

\* Broken sibling of EnsureFilings: persist follows fetch completion
\* order, the pre-cf13d58 _fetch_all that raised out of pending order.

CONSTANTS C1, C2, C3
Pending == <<C1, C2, C3>>
Codes == {C1, C2, C3}

VARIABLES fetch, persisted, handled, aborted
vars == <<fetch, persisted, handled, aborted>>

Init ==
  /\ fetch = [c \in Codes |-> "idle"]
  /\ persisted = {}
  /\ handled = {}
  /\ aborted = FALSE

Fetch(c) ==
  /\ fetch[c] = "idle"
  /\ fetch' = [fetch EXCEPT ![c] = "inflight"]
  /\ UNCHANGED <<persisted, handled, aborted>>

CompleteFetch(c, result) ==
  /\ fetch[c] = "inflight"
  /\ result \in {"ok", "foliyo", "boom"}
  /\ fetch' = [fetch EXCEPT ![c] = result]
  /\ UNCHANGED <<persisted, handled, aborted>>

PersistAny ==
  /\ ~aborted
  /\ \E c \in Codes:
       /\ fetch[c] \in {"ok", "foliyo", "boom"}
       /\ c \notin handled
       /\ handled' = handled \union {c}
       /\ IF fetch[c] = "boom"
          THEN /\ aborted' = TRUE
               /\ UNCHANGED <<fetch, persisted>>
          ELSE /\ persisted' = IF fetch[c] = "ok" THEN persisted \union {c} ELSE persisted
               /\ UNCHANGED <<fetch, aborted>>

Done ==
  /\ aborted \/ handled = Codes
  /\ UNCHANGED vars

Next ==
  \/ \E c \in Codes: Fetch(c)
  \/ \E c \in Codes, r \in {"ok", "foliyo", "boom"}: CompleteFetch(c, r)
  \/ PersistAny
  \/ Done

Spec == Init /\ [][Next]_vars

AbortAfterEarlier ==
  aborted =>
    \E i \in 1..Len(Pending):
      /\ fetch[Pending[i]] = "boom"
      /\ \A j \in 1..(i-1): fetch[Pending[j]] # "boom"
      /\ \A j \in 1..(i-1):
           fetch[Pending[j]] = "ok" => Pending[j] \in persisted
      /\ \A k \in i..Len(Pending):
           Pending[k] \notin persisted
====
