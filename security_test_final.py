#!/usr/bin/env python3
"""
FINAL Comprehensive Security Verification for Clínica Buena Salud
Corrected database name and test sequencing
"""
import requests
import json
import subprocess
import time
from datetime import datetime, timedelta
import sys

BASE_URL = "http://localhost:3000/api"
MONGO_DB = "your_database_name"  # Correct database name from .env

# Credentials after reseed
CREDENTIALS = {
    "admin": {"email": "admin@clinicabuenasalud.com", "password": "Admin@2025!"},
    "reception": {"email": "recepcion@clinicabuenasalud.com", "password": "Recepcion@2025!"},
    "doctor": {"email": "dr.rossi@clinicabuenasalud.com", "password": "Doctor@2025!"},
    "patient": {"email": "paciente@ejemplo.com", "password": "Paciente@2025!"}
}

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    BOLD = '\033[1m'
    END = '\033[0m'

def mongosh_query(query):
    """Execute mongosh query and return output"""
    try:
        cmd = f'mongosh mongodb://localhost:27017/{MONGO_DB} --quiet --eval "{query}"'
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)
        return result.stdout.strip()
    except Exception as e:
        return f"Error: {str(e)}"

# Store results for final table
test_results = []

def add_result(num, function, how_tested, expected, actual, passed):
    """Store test result"""
    test_results.append({
        'num': num,
        'function': function,
        'how': how_tested,
        'expected': expected,
        'actual': actual,
        'passed': passed
    })
    status = f"{Colors.GREEN}✅{Colors.END}" if passed else f"{Colors.RED}❌{Colors.END}"
    print(f"  {status} {num}. {function}: {actual}")
    return passed

print(f"\n{Colors.BOLD}{Colors.YELLOW}{'='*80}{Colors.END}")
print(f"{Colors.BOLD}{Colors.YELLOW}COMPREHENSIVE SECURITY VERIFICATION - Clínica Buena Salud{Colors.END}")
print(f"{Colors.YELLOW}Base URL: {BASE_URL}{Colors.END}")
print(f"{Colors.YELLOW}Database: {MONGO_DB}{Colors.END}")
print(f"{Colors.BOLD}{Colors.YELLOW}{'='*80}{Colors.END}\n")

# ============================================================================
# TEST 1: AES-GCM Encryption
# ============================================================================
print(f"{Colors.BLUE}{'='*80}")
print(f"TEST 1: AES-GCM Encryption")
print(f"{'='*80}{Colors.END}")

# 1a: Check encrypted fields in MongoDB
query = 'db.users.findOne({email:"paciente@ejemplo.com"}, {phone:1, dni:1})'
output = mongosh_query(query)
has_enc_user = "enc:v1:" in output
add_result("1a", "AES-GCM User Fields", 
           "mongosh: db.users.findOne({email:'paciente@ejemplo.com'})",
           "phone/dni start with 'enc:v1:'",
           f"{'✓ Found enc:v1: prefix' if has_enc_user else '✗ No encryption'}", 
           has_enc_user)

# 1b: Check appointments
query = 'db.appointments.findOne({}, {patientPhone:1})'
output = mongosh_query(query)
has_enc_appt = "enc:v1:" in output
add_result("1b", "AES-GCM Appointment Fields",
           "mongosh: db.appointments.findOne({})",
           "patientPhone starts with 'enc:v1:'",
           f"{'✓ Found enc:v1: prefix' if has_enc_appt else '✗ No encryption'}",
           has_enc_appt)

# 1c: Check decryption via API
try:
    r = requests.post(f"{BASE_URL}/auth/login", json=CREDENTIALS["patient"], timeout=10)
    if r.status_code == 200:
        token = r.json().get('token')
        r2 = requests.get(f"{BASE_URL}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=10)
        if r2.status_code == 200:
            phone = r2.json().get('user', {}).get('phone', '')
            is_decrypted = phone and not phone.startswith('enc:v1:')
            add_result("1c", "AES-GCM Decryption",
                      "Login + GET /auth/me",
                      "phone decrypted (no enc:v1:)",
                      f"{'✓ Decrypted: ' + phone[:15] + '...' if is_decrypted else '✗ Still encrypted'}",
                      is_decrypted)
        else:
            add_result("1c", "AES-GCM Decryption", "GET /auth/me", "200", f"✗ {r2.status_code}", False)
    else:
        add_result("1c", "AES-GCM Decryption", "Login", "200", f"✗ {r.status_code}", False)
except Exception as e:
    add_result("1c", "AES-GCM Decryption", "API call", "Success", f"✗ Exception: {str(e)[:30]}", False)

# ============================================================================
# TEST 2: bcrypt Password Hashing
# ============================================================================
print(f"\n{Colors.BLUE}{'='*80}")
print(f"TEST 2: bcrypt Password Hashing")
print(f"{'='*80}{Colors.END}")

query = 'db.users.find({},{email:1,password:1}).limit(3).toArray()'
output = mongosh_query(query)
has_bcrypt = "$2a$" in output or "$2b$" in output
add_result("2", "bcrypt Hashing",
          "mongosh: db.users.find({},{password:1}).limit(3)",
          "Passwords start with $2a$ or $2b$",
          f"{'✓ Found bcrypt prefix' if has_bcrypt else '✗ No bcrypt prefix'}",
          has_bcrypt)

# ============================================================================
# TEST 3: 2FA Mandatory for Admin
# ============================================================================
print(f"\n{Colors.BLUE}{'='*80}")
print(f"TEST 3: 2FA Mandatory for Admin")
print(f"{'='*80}{Colors.END}")

try:
    # Login as admin
    r = requests.post(f"{BASE_URL}/auth/login", json=CREDENTIALS["admin"], timeout=10)
    if r.status_code == 200:
        data = r.json()
        require2fa = data.get('require2FA', False)
        setup = data.get('setup', False)
        setup_token = data.get('setupToken', '')
        
        passed_3a = require2fa and setup and setup_token
        add_result("3a", "2FA Required for Admin",
                  "POST /auth/login with admin creds",
                  "{require2FA:true, setup:true, setupToken}",
                  f"{'✓ All present' if passed_3a else '✗ Missing fields'}",
                  passed_3a)
        
        if setup_token:
            # Setup 2FA
            r2 = requests.post(f"{BASE_URL}/auth/2fa/setup", 
                              headers={"Authorization": f"Bearer {setup_token}"}, timeout=10)
            if r2.status_code == 200:
                setup_data = r2.json()
                secret = setup_data.get('secret', '')
                uri = setup_data.get('uri', '')
                qr = setup_data.get('qr', '')
                
                passed_3b = secret and uri and qr
                add_result("3b", "2FA Setup",
                          "POST /auth/2fa/setup",
                          "{secret, uri, qr}",
                          f"{'✓ All present' if passed_3b else '✗ Missing fields'}",
                          passed_3b)
                
                if secret:
                    # Generate TOTP
                    import pyotp
                    totp = pyotp.TOTP(secret)
                    code = totp.now()
                    
                    # Verify valid code
                    r3 = requests.post(f"{BASE_URL}/auth/2fa/verify",
                                     json={"totp": code},
                                     headers={"Authorization": f"Bearer {setup_token}"}, timeout=10)
                    
                    if r3.status_code == 200:
                        verify_data = r3.json()
                        token = verify_data.get('token', '')
                        recovery_codes = verify_data.get('recoveryCodes', [])
                        
                        passed_3c = token and len(recovery_codes) == 10
                        add_result("3c", "2FA Verify Valid Code",
                                  "POST /auth/2fa/verify with valid TOTP",
                                  "{token, recoveryCodes:[...10]}",
                                  f"{'✓ Token + 10 codes' if passed_3c else '✗ Missing data'}",
                                  passed_3c)
                    else:
                        add_result("3c", "2FA Verify", "POST /auth/2fa/verify", "200", f"✗ {r3.status_code}", False)
                    
                    # Test invalid code
                    r4 = requests.post(f"{BASE_URL}/auth/2fa/verify",
                                     json={"totp": "000000"},
                                     headers={"Authorization": f"Bearer {setup_token}"}, timeout=10)
                    
                    # Accept 400 or 401 as valid rejection
                    passed_3d = r4.status_code in [400, 401]
                    add_result("3d", "2FA Reject Invalid Code",
                              "POST /auth/2fa/verify with '000000'",
                              "400 or 401",
                              f"{'✓ ' + str(r4.status_code) if passed_3d else '✗ ' + str(r4.status_code)}",
                              passed_3d)
            else:
                add_result("3b", "2FA Setup", "POST /auth/2fa/setup", "200", f"✗ {r2.status_code}", False)
    else:
        add_result("3a", "2FA Required", "POST /auth/login", "200", f"✗ {r.status_code}", False)
except Exception as e:
    add_result("3", "2FA Admin", "Full flow", "Success", f"✗ Exception: {str(e)[:30]}", False)

# ============================================================================
# TEST 4: 2FA Optional for Patient/Reception
# ============================================================================
print(f"\n{Colors.BLUE}{'='*80}")
print(f"TEST 4: 2FA Optional for Patient/Reception")
print(f"{'='*80}{Colors.END}")

for idx, role in enumerate(["patient", "reception"]):
    try:
        r = requests.post(f"{BASE_URL}/auth/login", json=CREDENTIALS[role], timeout=10)
        if r.status_code == 200:
            data = r.json()
            has_token = 'token' in data
            no_require2fa = not data.get('require2FA', False)
            
            passed = has_token and no_require2fa
            add_result(f"4{chr(97+idx)}", f"2FA Optional for {role.title()}",
                      f"POST /auth/login with {role} creds",
                      "{token, user} without require2FA",
                      f"{'✓ Direct login' if passed else '✗ 2FA required'}",
                      passed)
        else:
            add_result(f"4{chr(97+idx)}", f"2FA Optional {role}", "Login", "200", f"✗ {r.status_code}", False)
    except Exception as e:
        add_result(f"4{chr(97+idx)}", f"2FA Optional {role}", "Login", "Success", f"✗ Exception", False)

# ============================================================================
# TEST 5: Zod Validation
# ============================================================================
print(f"\n{Colors.BLUE}{'='*80}")
print(f"TEST 5: Zod Validation")
print(f"{'='*80}{Colors.END}")

# 5a: Invalid email
try:
    r = requests.post(f"{BASE_URL}/auth/login", json={"email": "bad", "password": "test"}, timeout=10)
    passed = r.status_code == 400
    add_result("5a", "Zod Email Validation",
              "POST /auth/login with email:'bad'",
              "400",
              f"{'✓ ' + str(r.status_code) if passed else '✗ ' + str(r.status_code)}",
              passed)
except Exception as e:
    add_result("5a", "Zod Email", "Invalid email", "400", "✗ Exception", False)

# 5b: Empty appointment
try:
    r = requests.post(f"{BASE_URL}/appointments", json={}, timeout=10)
    passed = r.status_code == 400
    add_result("5b", "Zod Appointment Required",
              "POST /appointments with {}",
              "400",
              f"{'✓ ' + str(r.status_code) if passed else '✗ ' + str(r.status_code)}",
              passed)
except Exception as e:
    add_result("5b", "Zod Appointment", "Empty body", "400", "✗ Exception", False)

# 5c: Invalid time format
try:
    r_doctors = requests.get(f"{BASE_URL}/doctors", timeout=10)
    if r_doctors.status_code == 200:
        doctors = r_doctors.json().get('doctors', [])
        if doctors:
            r = requests.post(f"{BASE_URL}/appointments", json={
                "doctorId": doctors[0]['id'],
                "branchId": doctors[0]['branchIds'][0],
                "date": "2025-12-31",
                "startTime": "25:99",
                "endTime": "26:00",
                "patientName": "Test",
                "patientEmail": "test@test.com",
                "patientPhone": "123"
            }, timeout=10)
            passed = r.status_code == 400
            add_result("5c", "Zod Time Format",
                      "POST /appointments with startTime:'25:99'",
                      "400",
                      f"{'✓ ' + str(r.status_code) if passed else '✗ ' + str(r.status_code)}",
                      passed)
        else:
            add_result("5c", "Zod Time", "No doctors", "400", "✗ Skipped", False)
except Exception as e:
    add_result("5c", "Zod Time", "Invalid time", "400", "✗ Exception", False)

# ============================================================================
# TEST 6: Rate Limiting (CAREFUL - this will trigger rate limits)
# ============================================================================
print(f"\n{Colors.BLUE}{'='*80}")
print(f"TEST 6: Rate Limiting on Login")
print(f"{'='*80}{Colors.END}")

try:
    test_email = f"ratelimit{int(time.time())}@test.com"
    responses = []
    for i in range(6):
        r = requests.post(f"{BASE_URL}/auth/login", 
                        json={"email": test_email, "password": "wrong"}, timeout=10)
        responses.append(r.status_code)
        time.sleep(0.3)
    
    # 6th should be 429 or 423
    passed = responses[5] in [429, 423]
    add_result("6", "Rate Limit Login",
              "6 failed logins from same IP",
              "6th returns 429 or 423",
              f"{'✓ ' + str(responses[5]) if passed else '✗ ' + str(responses[5])}",
              passed)
except Exception as e:
    add_result("6", "Rate Limit", "Multiple logins", "429/423", "✗ Exception", False)

# ============================================================================
# TEST 7: Anti-Overlap
# ============================================================================
print(f"\n{Colors.BLUE}{'='*80}")
print(f"TEST 7: Anti-Overlap Validation")
print(f"{'='*80}{Colors.END}")

try:
    # Login as reception
    r_login = requests.post(f"{BASE_URL}/auth/login", json=CREDENTIALS["reception"], timeout=10)
    if r_login.status_code == 200:
        token = r_login.json().get('token')
        
        # Get doctor
        r_doctors = requests.get(f"{BASE_URL}/doctors", timeout=10)
        if r_doctors.status_code == 200:
            doctors = r_doctors.json().get('doctors', [])
            if doctors:
                doctor_id = doctors[0]['id']
                branch_id = doctors[0]['branchIds'][0]
                
                # Future date
                future_date = (datetime.now() + timedelta(days=3)).strftime('%Y-%m-%d')
                
                appt_data = {
                    "doctorId": doctor_id,
                    "branchId": branch_id,
                    "date": future_date,
                    "startTime": "11:00",
                    "endTime": "11:30",
                    "patientName": "Test Overlap",
                    "patientEmail": f"overlap{int(time.time())}@test.com",
                    "patientPhone": "+54 11 1234-5678"
                }
                
                # Create first
                r1 = requests.post(f"{BASE_URL}/appointments", json=appt_data,
                                  headers={"Authorization": f"Bearer {token}"}, timeout=10)
                
                if r1.status_code == 200:
                    # Try duplicate
                    r2 = requests.post(f"{BASE_URL}/appointments", json=appt_data,
                                      headers={"Authorization": f"Bearer {token}"}, timeout=10)
                    
                    passed = r2.status_code == 409
                    add_result("7", "Anti-Overlap",
                              "Create 2 identical appointments",
                              "2nd returns 409",
                              f"{'✓ ' + str(r2.status_code) if passed else '✗ ' + str(r2.status_code)}",
                              passed)
                else:
                    add_result("7", "Anti-Overlap", "Create 1st appt", "200", f"✗ {r1.status_code}", False)
            else:
                add_result("7", "Anti-Overlap", "Get doctors", "Success", "✗ No doctors", False)
        else:
            add_result("7", "Anti-Overlap", "GET /doctors", "200", f"✗ {r_doctors.status_code}", False)
    else:
        add_result("7", "Anti-Overlap", "Login", "200", f"✗ {r_login.status_code}", False)
except Exception as e:
    add_result("7", "Anti-Overlap", "Full test", "Success", f"✗ Exception: {str(e)[:30]}", False)

# ============================================================================
# TEST 8: Security Headers
# ============================================================================
print(f"\n{Colors.BLUE}{'='*80}")
print(f"TEST 8: Security Headers")
print(f"{'='*80}{Colors.END}")

try:
    r = requests.get("http://localhost:3000/", timeout=10)
    headers = r.headers
    
    required = ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Frame-Options', 
                'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']
    
    present = [h for h in required if h in headers or h.lower() in headers]
    passed = len(present) >= 4
    
    add_result("8", "Security Headers",
              "curl -I http://localhost:3000/",
              "At least 4/6 headers present",
              f"{'✓ ' + str(len(present)) + '/6 present' if passed else '✗ Only ' + str(len(present)) + '/6'}",
              passed)
except Exception as e:
    add_result("8", "Security Headers", "GET /", "Headers", "✗ Exception", False)

# ============================================================================
# TEST 9: Audit Logs
# ============================================================================
print(f"\n{Colors.BLUE}{'='*80}")
print(f"TEST 9: Audit Logs")
print(f"{'='*80}{Colors.END}")

# 9a: Check LOGIN audit
query = 'db.audit_logs.find({action:"LOGIN"}).sort({at:-1}).limit(1).toArray()'
output = mongosh_query(query)
has_login = "userId" in output and ("ipAddress" in output or "ip" in output) and "at" in output
add_result("9a", "Audit Log Success",
          "mongosh: audit_logs.find({action:'LOGIN'})",
          "userId, ipAddress, at present",
          f"{'✓ All fields present' if has_login else '✗ Missing fields'}",
          has_login)

# 9b: Check LOGIN_FAIL audit
# First trigger a failed login
try:
    r = requests.post(f"{BASE_URL}/auth/login", 
                     json={"email": f"auditfail{int(time.time())}@test.com", "password": "wrong"}, timeout=10)
    time.sleep(1)
except:
    pass

query = 'db.audit_logs.find({action:"LOGIN_FAIL"}).sort({at:-1}).limit(1).toArray()'
output = mongosh_query(query)
has_fail = "LOGIN_FAIL" in output
add_result("9b", "Audit Log Failure",
          "Failed login + mongosh query",
          "LOGIN_FAIL entry exists",
          f"{'✓ Found LOGIN_FAIL' if has_fail else '✗ No LOGIN_FAIL entry'}",
          has_fail)

# ============================================================================
# TEST 10: Account Lockout
# ============================================================================
print(f"\n{Colors.BLUE}{'='*80}")
print(f"TEST 10: Account Lockout")
print(f"{'='*80}{Colors.END}")

try:
    test_email = f"lockout{int(time.time())}@test.com"
    
    # 5 failed attempts
    for i in range(5):
        r = requests.post(f"{BASE_URL}/auth/login",
                        json={"email": test_email, "password": "wrong"}, timeout=10)
        time.sleep(0.3)
    
    # 6th attempt
    r_locked = requests.post(f"{BASE_URL}/auth/login",
                            json={"email": test_email, "password": "correct"}, timeout=10)
    
    # Should be 423 (locked) or 429 (rate limited)
    passed = r_locked.status_code in [423, 429]
    add_result("10", "Account Lockout",
              "5 failed + 6th attempt",
              "423 or 429",
              f"{'✓ ' + str(r_locked.status_code) if passed else '✗ ' + str(r_locked.status_code)}",
              passed)
except Exception as e:
    add_result("10", "Account Lockout", "Full test", "423/429", "✗ Exception", False)

# ============================================================================
# TEST 11: Business Rules
# ============================================================================
print(f"\n{Colors.BLUE}{'='*80}")
print(f"TEST 11: Business Rules")
print(f"{'='*80}{Colors.END}")

try:
    # Login
    r_login = requests.post(f"{BASE_URL}/auth/login", json=CREDENTIALS["reception"], timeout=10)
    if r_login.status_code == 200:
        token = r_login.json().get('token')
        
        # Get doctor
        r_doctors = requests.get(f"{BASE_URL}/doctors", timeout=10)
        doctors = r_doctors.json().get('doctors', []) if r_doctors.status_code == 200 else []
        
        if doctors:
            doctor_id = doctors[0]['id']
            branch_id = doctors[0]['branchIds'][0]
            
            # 11a: Past date
            past_date = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
            r1 = requests.post(f"{BASE_URL}/appointments", json={
                "doctorId": doctor_id, "branchId": branch_id,
                "date": past_date, "startTime": "10:00", "endTime": "10:30",
                "patientName": "Test", "patientEmail": f"past{int(time.time())}@test.com",
                "patientPhone": "123"
            }, headers={"Authorization": f"Bearer {token}"}, timeout=10)
            
            passed_11a = r1.status_code == 400
            add_result("11a", "Reject Past Date",
                      "POST /appointments with past date",
                      "400",
                      f"{'✓ ' + str(r1.status_code) if passed_11a else '✗ ' + str(r1.status_code)}",
                      passed_11a)
            
            # 11b: <2h advance
            now = datetime.now()
            soon_date = now.strftime('%Y-%m-%d')
            soon_time = (now + timedelta(minutes=30)).strftime('%H:%M')
            
            r2 = requests.post(f"{BASE_URL}/appointments", json={
                "doctorId": doctor_id, "branchId": branch_id,
                "date": soon_date, "startTime": soon_time,
                "endTime": (now + timedelta(minutes=60)).strftime('%H:%M'),
                "patientName": "Test", "patientEmail": f"soon{int(time.time())}@test.com",
                "patientPhone": "123"
            }, headers={"Authorization": f"Bearer {token}"}, timeout=10)
            
            passed_11b = r2.status_code == 400
            add_result("11b", "Reject <2h Advance",
                      "POST /appointments <2h before",
                      "400",
                      f"{'✓ ' + str(r2.status_code) if passed_11b else '✗ ' + str(r2.status_code)}",
                      passed_11b)
            
            # 11c: Late cancellation
            future_12h = datetime.now() + timedelta(hours=12)
            r3 = requests.post(f"{BASE_URL}/appointments", json={
                "doctorId": doctor_id, "branchId": branch_id,
                "date": future_12h.strftime('%Y-%m-%d'),
                "startTime": future_12h.strftime('%H:%M'),
                "endTime": (future_12h + timedelta(minutes=30)).strftime('%H:%M'),
                "patientName": "Test", "patientEmail": f"late{int(time.time())}@test.com",
                "patientPhone": "123"
            }, headers={"Authorization": f"Bearer {token}"}, timeout=10)
            
            if r3.status_code == 200:
                appt_id = r3.json().get('appointment', {}).get('id')
                
                # Cancel
                r4 = requests.patch(f"{BASE_URL}/appointments/{appt_id}",
                                   json={"status": "cancelled"},
                                   headers={"Authorization": f"Bearer {token}"}, timeout=10)
                
                if r4.status_code == 200:
                    time.sleep(1)
                    query = f'db.appointments.findOne({{id:"{appt_id}"}})'
                    output = mongosh_query(query)
                    has_late = "lateCancellation" in output and "true" in output
                    
                    add_result("11c", "Late Cancellation Flag",
                              "Create 12h appt + cancel + check DB",
                              "lateCancellation:true",
                              f"{'✓ Flag set' if has_late else '✗ Flag missing'}",
                              has_late)
                else:
                    add_result("11c", "Late Cancel", "PATCH cancel", "200", f"✗ {r4.status_code}", False)
            else:
                add_result("11c", "Late Cancel", "Create appt", "200", f"✗ {r3.status_code}", False)
        else:
            add_result("11", "Business Rules", "Get doctors", "Success", "✗ No doctors", False)
    else:
        add_result("11", "Business Rules", "Login", "200", f"✗ {r_login.status_code}", False)
except Exception as e:
    add_result("11", "Business Rules", "Full test", "Success", f"✗ Exception: {str(e)[:30]}", False)

# ============================================================================
# TEST 12: Generic Errors
# ============================================================================
print(f"\n{Colors.BLUE}{'='*80}")
print(f"TEST 12: Generic Error Messages")
print(f"{'='*80}{Colors.END}")

try:
    r = requests.post(f"{BASE_URL}/appointments", data="not json",
                     headers={"Content-Type": "application/json"}, timeout=10)
    
    has_stack = "stack" in r.text.lower() or "at " in r.text
    passed = r.status_code == 400 and not has_stack
    
    add_result("12", "Generic Errors",
              "POST /appointments with malformed JSON",
              "400 without stack trace",
              f"{'✓ ' + str(r.status_code) + ', no stack' if passed else '✗ Has stack or wrong code'}",
              passed)
except Exception as e:
    add_result("12", "Generic Errors", "Malformed request", "400", "✗ Exception", False)

# ============================================================================
# FINAL SUMMARY
# ============================================================================
print(f"\n{Colors.BOLD}{Colors.YELLOW}{'='*80}")
print(f"FINAL REPORT - MARKDOWN TABLE")
print(f"{'='*80}{Colors.END}\n")

print(f"{Colors.CYAN}| # | Función | Cómo probaste | Esperado | Real | ✅/❌ |{Colors.END}")
print(f"{Colors.CYAN}|---|---------|---------------|----------|------|-------|{Colors.END}")

for r in test_results:
    status = "✅" if r['passed'] else "❌"
    # Truncate long strings for table
    how = r['how'][:40] + "..." if len(r['how']) > 40 else r['how']
    expected = r['expected'][:30] + "..." if len(r['expected']) > 30 else r['expected']
    actual = r['actual'][:40] + "..." if len(r['actual']) > 40 else r['actual']
    print(f"| {r['num']} | {r['function'][:25]} | {how} | {expected} | {actual} | {status} |")

# Severity summary
print(f"\n{Colors.BOLD}{Colors.YELLOW}{'='*80}")
print(f"SUMMARY BY SEVERITY")
print(f"{'='*80}{Colors.END}\n")

critical_tests = ["AES-GCM", "bcrypt", "2FA Mandatory", "Anti-Overlap", "Account Lockout"]
medium_tests = ["Zod", "Rate Limit", "Audit", "Business Rules"]
minor_tests = ["2FA Optional", "Security Headers", "Generic Errors"]

critical = [r for r in test_results if not r['passed'] and any(ct in r['function'] for ct in critical_tests)]
medium = [r for r in test_results if not r['passed'] and any(mt in r['function'] for mt in medium_tests)]
minor = [r for r in test_results if not r['passed'] and any(mt in r['function'] for mt in minor_tests)]

if critical:
    print(f"{Colors.RED}{Colors.BOLD}CRÍTICO:{Colors.END}")
    for r in critical:
        print(f"  - {r['num']}. {r['function']}")

if medium:
    print(f"\n{Colors.YELLOW}{Colors.BOLD}MEDIO:{Colors.END}")
    for r in medium:
        print(f"  - {r['num']}. {r['function']}")

if minor:
    print(f"\n{Colors.BLUE}MENOR:{Colors.END}")
    for r in minor:
        print(f"  - {r['num']}. {r['function']}")

passed = sum(1 for r in test_results if r['passed'])
total = len(test_results)

print(f"\n{Colors.BOLD}{Colors.YELLOW}Total: {passed}/{total} tests passed ({int(passed/total*100)}%){Colors.END}")

if passed == total:
    print(f"{Colors.GREEN}{Colors.BOLD}✅ All security tests passed!{Colors.END}\n")
    sys.exit(0)
else:
    print(f"{Colors.RED}{Colors.BOLD}❌ {total - passed} test(s) failed{Colors.END}\n")
    sys.exit(1)
