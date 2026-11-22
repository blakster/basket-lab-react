---- MODULE EnsureFilings ----
EXTENDS Integers, FiniteSets, Sequences, TLC

\* Models apps/api/app/ingest/ensure.py:
\* _fetch_all fetches pending codes concurrently (Fetch / CompleteFetch),
\* then ensure_filings persists in pending order (PersistNext).
\* An unexpected Exception (boom) re-raises at the first pending code
\* whose fetch exploded, after earlier codes have been written.
\* FoliyoError is a value and does not abort.

CONSTANTS C1, C2, C3
Pending == <<C1, C2, C3>>
Codes == {C1, C2, C3}

VARIABLES fetch, persisted, persistPos, aborted
vars == <<fetch, persisted, persistPos, aborted>>

Results == {"idle", "inflight", "ok", "foliyo", "boom"}

Init ==
  /\ fetch = [c \in Codes |-> "idle"]
  /\ persisted = {}
  /\ persistPos = 1
  /\ aborted = FALSE

Fetch(c) ==
  /\ fetch[c] = "idle"
  /\ fetch' = [fetch EXCEPT ![c] = "inflight"]
  /\ UNCHANGED <<persisted, persistPos, aborted>>

CompleteFetch(c, result) ==
  /\ fetch[c] = "inflight"
  /\ result \in {"ok", "foliyo", "boom"}
  /\ fetch' = [fetch EXCEPT ![c] = result]
  /\ UNCHANGED <<persisted, persistPos, aborted>>

AllFetched == \A c \in Codes: fetch[c] \in {"ok", "foliyo", "boom"}
current == Pending[persistPos]

PersistNext ==
  /\ ~aborted
  /\ AllFetched
  /\ persistPos <= Len(Pending)
  /\ IF fetch[current] = "boom"
     THEN /\ aborted' = TRUE
          /\ persistPos' = persistPos + 1
          /\ UNCHANGED <<fetch, persisted>>
     ELSE /\ persistPos' = persistPos + 1
          /\ persisted' = IF fetch[current] = "ok"
                          THEN persisted \union {current}
                          ELSE persisted
          /\ UNCHANGED <<fetch, aborted>>

Done ==
  /\ aborted \/ persistPos > Len(Pending)
  /\ UNCHANGED vars

Next ==
  \/ \E c \in Codes: Fetch(c)
  \/ \E c \in Codes, r \in {"ok", "foliyo", "boom"}: CompleteFetch(c, r)
  \/ PersistNext
  \/ Done

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ fetch \in [Codes -> Results]
  /\ persisted \subseteq Codes
  /\ persistPos \in 1..(Len(Pending)+1)
  /\ aborted \in BOOLEAN

\* cf13d58 / 6eac21d: abort at the first boom in pending order.
\* Earlier ok codes are persisted. That boom and every later code are not.
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
