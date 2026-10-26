# FOMC presser vs statement reversal study

Reads the SF Fed U.S. Monetary Policy Event-Study Database (public, no login) and asks how often the
press-conference window reverses the statement-window move in EUR/USD, USD/JPY, DXY, UST 2y/10y, 2s10s and ES.
Raw window moves only (no PCA factors), so nothing is fitted on the full sample.

    curl -sSL -A "Mozilla/5.0" https://www.frbsf.org/wp-content/uploads/USMPD.xlsx -o USMPD.xlsx
    python3 audit.py USMPD.xlsx   # timestamps, gaps between windows, missing values, additivity check
    python3 study.py USMPD.xlsx   # reversal rates, continuation, beta, presser variance share by regime

Needs `openpyxl`. Sample: meetings with the statement at 14:00 ET and the presser at 14:30 ET (windows abut at
14:20 ET); the 2011-12 meetings (12:30 statement, 14:15 presser) and the two March 2020 unscheduled meetings
are dropped. Results and exit-timing lines: project files `notes/fomc_presser_reversal_26oct2026.md`.
