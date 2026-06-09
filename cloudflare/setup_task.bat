@echo off
echo Registering FedForex nightly strategy review task...
schtasks /create /tn "FedForex_StrategyReview" /tr "node \"C:\Users\DESKTOP\Desktop\Claude Code\cloudflare\review_strategy.js\"" /sc daily /st 02:00 /f
if %errorlevel%==0 (
    echo.
    echo SUCCESS - Task registered! Runs every night at 2:00 AM IST.
    echo To run manually anytime: node review_strategy.js --force
) else (
    echo.
    echo FAILED - try right-clicking this file and "Run as administrator"
)
pause
