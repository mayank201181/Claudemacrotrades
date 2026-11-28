-- R37 amendment, 28 Nov 2026 (owner, thread "Fix stale rates in dollar drivers": "Why is it stale.. why are we not
-- using the latest one"). Appends point 7. Market pack section I now takes each 2y leg's freshest print (ECB and MOF
-- brought up to the latest day from the live Trading Economics day change) and prints a RATES AS-OF line ending FRESH
-- or STALE. Single statement; read back length(body) 7039 -> new length, right(body) starts "7. RATE AS-OF".
update dash.rules set body = body || $p$

7. RATE AS-OF (owner's ask 28 Nov 2026). Line (a) ends with "as of <date>" for each differential, taken from section I's RATES AS-OF line; when a leg was brought up to date from the live day change, add "(EUR live)" or "(JPY live)". When that line says STALE, print the as-of date and the word STALE in red (color #c0392b) in the digest and in the phone alert, name the stale leg, and say in (e) that the rate-model read rests on stale inputs. FRESH prints nothing extra. The old "US 2y move not yet in the differentials" clause in 3(a) no longer applies: section I no longer prints it.$p$ where rid = 'R37' and length(body) = 7039;
