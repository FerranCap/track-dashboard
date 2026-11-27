@echo off
python "%~dp0update_data.py" %*
exit /b %errorlevel%
