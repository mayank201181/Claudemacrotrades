-- R39 amendment, 26 Nov 2026 (owner's "Yeah sure pls", thread "Pick ChatGPT tasks for spare capacity", after the Astra A3
-- study: 10Y UST betas per market; local residual moves did not revert, 0 of 93 cells at BH q<=0.10). Adds point 6:
-- line (e) READ takes its LOCAL vs GLOBAL BETA call from pack section J4, not from eyeballing raw moves.
-- Run as the single statement below (appends to the body). Before: length 3480, md5 f5718f2893fe4f4b10e3471eb7fa1d9b.
-- Applied 26 Nov 2026 ~14:30 SGT; read back: length 4161, md5 24ddb3e514c9edaa0aaf456654e8131a.
update dash.rules set body = body || $p$

6. UST BETA SPLIT (amendment 26 Nov 2026, from a 2010-2026 study of official curves). Section J4 splits each 10Y govvy's last 5-session move into a UST part (study beta x the UST 10Y move) and a LOCAL part, with the local z. Line (e) READ uses it: call a market LOCAL when |local z| is 1.5 or more, GLOBAL BETA when the UST part is most of the move and |local z| is under 1.0, MIXED otherwise, and quote the split for the market it names (e.g. "JGB 10Y -21: UST part -11, local -10, z -1.7"). A local z never makes a fade case by itself: in the study local residuals did not revert (0 of 93 cells). Markets missing from J4 (history too short) get no call from it; say "no split".$p$ where rid = 'R39' and status = 'in_force' and md5(body) = 'f5718f2893fe4f4b10e3471eb7fa1d9b';
