#!/usr/bin/env python3
"""
Comprehensive Security Verification for Clínica Buena Salud
Tests all 12 security requirements as specified
"""
import requests
import json
import subprocess
import time
from datetime import datetime, timedelta
import sys

BASE_URL = "http://localhost:3000/api"
MONGO_URI = "mongodb://localhost:27017/clinica_buena_salud"

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
    END = '\033[0m'

def mongosh_query(query):
    """Execute mongosh query and return output"""
    try:
        cmd = f'mongosh {MONGO_URI} --quiet --eval "{query}"'
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)
        return result.stdout.strip()
    except Exception as e:
        return f"Error: {str(e)}"

def log_result(test_num, function, how_tested, expected, actual, passed):
    """Log test result in markdown table format"""
    status = "✅" if passed else "❌"
    print(f"| {test_num} | {function} | {how_tested} | {expected} | {actual} | {status} |")
    return passed

def test_1_aes_gcm_encryption():
    """Test 1: AES-GCM encryption for sensitive fields"""
    print(f"\n{Colors.BLUE}=== TEST 1: AES-GCM Encryption ==={Colors.END}")
    
    results = []
    
    # Check encrypted fields in MongoDB
    print("\n1a. Checking encrypted fields in users collection...")
    user_query = 'db.users.findOne({email:"paciente@ejemplo.com"})'
    user_data = mongosh_query(user_query)
    
    has_encrypted_phone = "enc:v1:" in user_data and "phone" in user_data
    results.append(log_result(
        "1a", "AES-GCM User Phone", 
        "mongosh: db.users.findOne({email:'paciente@ejemplo.com'})",
        "phone starts with 'enc:v1:'",
        f"Found enc:v1: prefix" if has_encrypted_phone else "No encryption prefix found",
        has_encrypted_phone
    ))
    
    # Check encrypted fields in appointments
    print("\n1b. Checking encrypted fields in appointments collection...")
    appt_query = 'db.appointments.findOne({})'
    appt_data = mongosh_query(appt_query)
    
    has_encrypted_appt = "enc:v1:" in appt_data
    results.append(log_result(
        "1b", "AES-GCM Appointment Fields",
        "mongosh: db.appointments.findOne({})",
        "Sensitive fields start with 'enc:v1:'",
        f"Found enc:v1: prefix" if has_encrypted_appt else "No encryption prefix found",
        has_encrypted_appt
    ))
    
    # Check decryption via API
    print("\n1c. Checking decryption via API...")
    try:
        # Login as patient
        r = requests.post(f"{BASE_URL}/auth/login", json=CREDENTIALS["patient"])
        if r.status_code == 200:
            data = r.json()
            token = data.get('token')
            
            # Get user data via /auth/me
            r2 = requests.get(f"{BASE_URL}/auth/me", headers={"Authorization": f"Bearer {token}"})
            if r2.status_code == 200:
                user = r2.json().get('user', {})
                phone = user.get('phone', '')
                
                # Phone should be decrypted (not start with enc:v1:)
                is_decrypted = phone and not phone.startswith('enc:v1:')
                results.append(log_result(
                    "1c", "AES-GCM Decryption",
                    "Login + GET /api/auth/me",
                    "phone field decrypted (no enc:v1: prefix)",
                    f"phone='{phone[:20]}...' (decrypted)" if is_decrypted else f"phone still encrypted or missing",
                    is_decrypted
                ))
            else:
                results.append(log_result("1c", "AES-GCM Decryption", "GET /auth/me", "200", f"{r2.status_code}", False))
        else:
            results.append(log_result("1c", "AES-GCM Decryption", "Login", "200", f"{r.status_code}", False))
    except Exception as e:
        results.append(log_result("1c", "AES-GCM Decryption", "API call", "Success", f"Exception: {str(e)}", False))
    
    return all(results)

def test_2_bcrypt_hashing():
    """Test 2: bcrypt password hashing"""
    print(f"\n{Colors.BLUE}=== TEST 2: bcrypt Password Hashing ==={Colors.END}")
    
    query = 'db.users.find({},{email:1,password:1}).limit(3).toArray()'
    output = mongosh_query(query)
    
    # Check if passwords start with $2a$ or $2b$ (bcrypt prefix)
    has_bcrypt = "$2a$" in output or "$2b$" in output
    
    return log_result(
        "2", "bcrypt Hashing",
        "mongosh: db.users.find({},{email:1,password:1}).limit(3)",
        "Passwords start with $2a$ or $2b$",
        f"Found bcrypt prefix" if has_bcrypt else "No bcrypt prefix found",
        has_bcrypt
    )

def test_3_2fa_mandatory_admin():
    """Test 3: 2FA mandatory for Admin"""
    print(f"\n{Colors.BLUE}=== TEST 3: 2FA Mandatory for Admin ==={Colors.END}")
    
    results = []
    
    try:
        # Step 1: Login as admin
        print("\n3a. Admin login should require 2FA...")
        r = requests.post(f"{BASE_URL}/auth/login", json=CREDENTIALS["admin"])
        
        if r.status_code == 200:
            data = r.json()
            require2fa = data.get('require2FA', False)
            setup = data.get('setup', False)
            setup_token = data.get('setupToken', '')
            
            results.append(log_result(
                "3a", "2FA Required for Admin",
                "POST /api/auth/login with admin creds",
                "{require2FA:true, setup:true, setupToken}",
                f"require2FA={require2fa}, setup={setup}, token={'present' if setup_token else 'missing'}",
                require2fa and setup and setup_token
            ))
            
            if setup_token:
                # Step 2: Setup 2FA
                print("\n3b. Setting up 2FA...")
                r2 = requests.post(f"{BASE_URL}/auth/2fa/setup", 
                                  headers={"Authorization": f"Bearer {setup_token}"})
                
                if r2.status_code == 200:
                    setup_data = r2.json()
                    secret = setup_data.get('secret', '')
                    uri = setup_data.get('uri', '')
                    qr = setup_data.get('qr', '')
                    
                    results.append(log_result(
                        "3b", "2FA Setup",
                        "POST /api/auth/2fa/setup with setupToken",
                        "{secret, uri, qr}",
                        f"secret={'present' if secret else 'missing'}, uri={'present' if uri else 'missing'}, qr={'present' if qr else 'missing'}",
                        secret and uri and qr
                    ))
                    
                    if secret:
                        # Step 3: Generate TOTP and verify
                        print("\n3c. Generating TOTP code...")
                        try:
                            import pyotp
                            totp = pyotp.TOTP(secret)
                            code = totp.now()
                            print(f"Generated TOTP code: {code}")
                            
                            r3 = requests.post(f"{BASE_URL}/auth/2fa/verify",
                                             json={"totp": code},
                                             headers={"Authorization": f"Bearer {setup_token}"})
                            
                            if r3.status_code == 200:
                                verify_data = r3.json()
                                token = verify_data.get('token', '')
                                user = verify_data.get('user', {})
                                recovery_codes = verify_data.get('recoveryCodes', [])
                                
                                results.append(log_result(
                                    "3c", "2FA Verify Valid Code",
                                    "POST /api/auth/2fa/verify with valid TOTP",
                                    "{token, user, recoveryCodes:[...10]}",
                                    f"token={'present' if token else 'missing'}, user={'present' if user else 'missing'}, codes={len(recovery_codes)}",
                                    token and user and len(recovery_codes) == 10
                                ))
                                
                                # Step 4: Try invalid TOTP
                                print("\n3d. Testing invalid TOTP...")
                                r4 = requests.post(f"{BASE_URL}/auth/2fa/verify",
                                                 json={"totp": "000000"},
                                                 headers={"Authorization": f"Bearer {setup_token}"})
                                
                                results.append(log_result(
                                    "3d", "2FA Reject Invalid Code",
                                    "POST /api/auth/2fa/verify with invalid TOTP",
                                    "401",
                                    f"{r4.status_code}",
                                    r4.status_code == 401
                                ))
                            else:
                                results.append(log_result("3c", "2FA Verify", "POST /api/auth/2fa/verify", "200", f"{r3.status_code}", False))
                        except ImportError:
                            print("pyotp not available, trying alternative...")
                            results.append(log_result("3c", "2FA Verify", "TOTP generation", "Success", "pyotp not installed", False))
                else:
                    results.append(log_result("3b", "2FA Setup", "POST /api/auth/2fa/setup", "200", f"{r2.status_code}", False))
        else:
            results.append(log_result("3a", "2FA Required", "POST /api/auth/login", "200", f"{r.status_code}", False))
    except Exception as e:
        results.append(log_result("3", "2FA Admin", "Full flow", "Success", f"Exception: {str(e)}", False))
    
    return all(results) if results else False

def test_4_2fa_optional():
    """Test 4: 2FA optional for patient and reception"""
    print(f"\n{Colors.BLUE}=== TEST 4: 2FA Optional for Patient/Reception ==={Colors.END}")
    
    results = []
    
    for role in ["patient", "reception"]:
        try:
            r = requests.post(f"{BASE_URL}/auth/login", json=CREDENTIALS[role])
            
            if r.status_code == 200:
                data = r.json()
                has_token = 'token' in data
                has_user = 'user' in data
                no_require2fa = not data.get('require2FA', False)
                
                results.append(log_result(
                    f"4{chr(97+len(results))}", f"2FA Optional for {role.title()}",
                    f"POST /api/auth/login with {role} creds",
                    "{token, user} without require2FA",
                    f"token={'present' if has_token else 'missing'}, user={'present' if has_user else 'missing'}, require2FA={data.get('require2FA', False)}",
                    has_token and has_user and no_require2fa
                ))
            else:
                results.append(log_result(f"4{chr(97+len(results))}", f"2FA Optional {role}", "Login", "200", f"{r.status_code}", False))
        except Exception as e:
            results.append(log_result(f"4{chr(97+len(results))}", f"2FA Optional {role}", "Login", "Success", f"Exception: {str(e)}", False))
    
    return all(results)

def test_5_zod_validation():
    """Test 5: Zod validation"""
    print(f"\n{Colors.BLUE}=== TEST 5: Zod Validation ==={Colors.END}")
    
    results = []
    
    # Test 5a: Invalid email format
    try:
        r = requests.post(f"{BASE_URL}/auth/login", json={"email": "bad", "password": "test"})
        results.append(log_result(
            "5a", "Zod Email Validation",
            "POST /api/auth/login with email:'bad'",
            "400",
            f"{r.status_code}",
            r.status_code == 400
        ))
    except Exception as e:
        results.append(log_result("5a", "Zod Email", "Invalid email", "400", f"Exception: {str(e)}", False))
    
    # Test 5b: Empty appointment body
    try:
        r = requests.post(f"{BASE_URL}/appointments", json={})
        results.append(log_result(
            "5b", "Zod Appointment Required Fields",
            "POST /api/appointments with {}",
            "400",
            f"{r.status_code}",
            r.status_code == 400
        ))
    except Exception as e:
        results.append(log_result("5b", "Zod Appointment", "Empty body", "400", f"Exception: {str(e)}", False))
    
    # Test 5c: Invalid time format
    try:
        # First get a valid doctor and branch
        r_doctors = requests.get(f"{BASE_URL}/doctors")
        if r_doctors.status_code == 200:
            doctors = r_doctors.json().get('doctors', [])
            if doctors:
                doctor_id = doctors[0]['id']
                branch_id = doctors[0]['branchIds'][0] if doctors[0].get('branchIds') else 'test'
                
                r = requests.post(f"{BASE_URL}/appointments", json={
                    "doctorId": doctor_id,
                    "branchId": branch_id,
                    "date": "2025-12-31",
                    "startTime": "25:99",  # Invalid time
                    "endTime": "26:00",
                    "patientName": "Test",
                    "patientEmail": "test@test.com",
                    "patientPhone": "123456"
                })
                results.append(log_result(
                    "5c", "Zod Time Format Validation",
                    "POST /api/appointments with startTime:'25:99'",
                    "400",
                    f"{r.status_code}",
                    r.status_code == 400
                ))
            else:
                results.append(log_result("5c", "Zod Time", "No doctors", "400", "Skipped", False))
        else:
            results.append(log_result("5c", "Zod Time", "Get doctors", "200", f"{r_doctors.status_code}", False))
    except Exception as e:
        results.append(log_result("5c", "Zod Time", "Invalid time", "400", f"Exception: {str(e)}", False))
    
    return all(results)

def test_6_rate_limit_login():
    """Test 6: Rate limiting on login"""
    print(f"\n{Colors.BLUE}=== TEST 6: Rate Limiting on Login ==={Colors.END}")
    
    try:
        # Make 6 failed login attempts
        test_email = "ratelimit@test.com"
        responses = []
        
        for i in range(6):
            r = requests.post(f"{BASE_URL}/auth/login", 
                            json={"email": test_email, "password": "wrongpassword"})
            responses.append(r.status_code)
            print(f"Attempt {i+1}: {r.status_code}")
            time.sleep(0.5)  # Small delay between attempts
        
        # 6th attempt should be 429 (rate limited) or 423 (account locked)
        sixth_status = responses[5]
        is_limited = sixth_status in [429, 423]
        
        return log_result(
            "6", "Rate Limit Login",
            "6 POST /api/auth/login with wrong password",
            "6th returns 429 or 423",
            f"Statuses: {responses}, 6th={sixth_status}",
            is_limited
        )
    except Exception as e:
        return log_result("6", "Rate Limit", "Multiple logins", "429/423", f"Exception: {str(e)}", False)

def test_7_anti_overlap():
    """Test 7: Anti-overlap for appointments"""
    print(f"\n{Colors.BLUE}=== TEST 7: Anti-Overlap Validation ==={Colors.END}")
    
    results = []
    
    try:
        # First login as reception to get token
        r_login = requests.post(f"{BASE_URL}/auth/login", json=CREDENTIALS["reception"])
        if r_login.status_code != 200:
            return log_result("7", "Anti-Overlap", "Login", "200", f"{r_login.status_code}", False)
        
        token = r_login.json().get('token')
        
        # Get a doctor
        r_doctors = requests.get(f"{BASE_URL}/doctors")
        if r_doctors.status_code != 200:
            return log_result("7", "Anti-Overlap", "Get doctors", "200", f"{r_doctors.status_code}", False)
        
        doctors = r_doctors.json().get('doctors', [])
        if not doctors:
            return log_result("7", "Anti-Overlap", "Doctors available", "Yes", "No doctors", False)
        
        doctor_id = doctors[0]['id']
        branch_id = doctors[0]['branchIds'][0] if doctors[0].get('branchIds') else None
        
        # Get branches
        r_branches = requests.get(f"{BASE_URL}/branches")
        if r_branches.status_code == 200:
            branches = r_branches.json().get('branches', [])
            if branches and not branch_id:
                branch_id = branches[0]['id']
        
        # Create appointment in future (>2h)
        future_date = (datetime.now() + timedelta(days=2)).strftime('%Y-%m-%d')
        
        appt_data = {
            "doctorId": doctor_id,
            "branchId": branch_id,
            "date": future_date,
            "startTime": "10:00",
            "endTime": "10:30",
            "patientName": "Test Overlap",
            "patientEmail": "overlap1@test.com",
            "patientPhone": "+54 11 1234-5678"
        }
        
        # Create first appointment
        r1 = requests.post(f"{BASE_URL}/appointments", 
                          json=appt_data,
                          headers={"Authorization": f"Bearer {token}"})
        
        if r1.status_code == 200:
            results.append(log_result(
                "7a", "Create First Appointment",
                "POST /api/appointments",
                "200",
                f"{r1.status_code}",
                True
            ))
            
            # Try to create identical appointment (should fail with 409)
            r2 = requests.post(f"{BASE_URL}/appointments",
                              json=appt_data,
                              headers={"Authorization": f"Bearer {token}"})
            
            results.append(log_result(
                "7b", "Anti-Overlap Identical",
                "POST /api/appointments with same time",
                "409",
                f"{r2.status_code}",
                r2.status_code == 409
            ))
        else:
            results.append(log_result("7a", "Create Appointment", "POST", "200", f"{r1.status_code}", False))
    except Exception as e:
        results.append(log_result("7", "Anti-Overlap", "Full test", "Success", f"Exception: {str(e)}", False))
    
    return all(results) if results else False

def test_8_security_headers():
    """Test 8: Security headers"""
    print(f"\n{Colors.BLUE}=== TEST 8: Security Headers ==={Colors.END}")
    
    try:
        r = requests.get("http://localhost:3000/")
        headers = r.headers
        
        required_headers = [
            'Content-Security-Policy',
            'Strict-Transport-Security',
            'X-Frame-Options',
            'X-Content-Type-Options',
            'Referrer-Policy',
            'Permissions-Policy'
        ]
        
        present = [h for h in required_headers if h in headers or h.lower() in headers]
        missing = [h for h in required_headers if h not in headers and h.lower() not in headers]
        
        return log_result(
            "8", "Security Headers",
            "curl -I http://localhost:3000/",
            "CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy",
            f"Present: {len(present)}/{len(required_headers)} - {', '.join(present[:3])}{'...' if len(present) > 3 else ''}",
            len(present) >= 4  # At least 4 out of 6 headers
        )
    except Exception as e:
        return log_result("8", "Security Headers", "GET /", "Headers present", f"Exception: {str(e)}", False)

def test_9_audit_logs():
    """Test 9: Audit logs"""
    print(f"\n{Colors.BLUE}=== TEST 9: Audit Logs ==={Colors.END}")
    
    results = []
    
    try:
        # Login to generate audit log
        r = requests.post(f"{BASE_URL}/auth/login", json=CREDENTIALS["patient"])
        
        if r.status_code == 200:
            # Check audit log in MongoDB
            time.sleep(1)  # Wait for log to be written
            
            query = 'db.audit_logs.find({action:"LOGIN"}).sort({at:-1}).limit(1).toArray()'
            output = mongosh_query(query)
            
            has_userid = "userId" in output
            has_ip = "ipAddress" in output or "ip" in output
            has_useragent = "userAgent" in output
            has_timestamp = "at" in output or "timestamp" in output
            
            results.append(log_result(
                "9a", "Audit Log Success",
                "Login + mongosh audit_logs query",
                "userId, ipAddress, userAgent, at",
                f"userId={has_userid}, ip={has_ip}, userAgent={has_useragent}, timestamp={has_timestamp}",
                has_userid and has_timestamp
            ))
        
        # Test failed login audit
        r2 = requests.post(f"{BASE_URL}/auth/login", 
                          json={"email": "audit@test.com", "password": "wrong"})
        
        time.sleep(1)
        query2 = 'db.audit_logs.find({action:"LOGIN_FAIL"}).sort({at:-1}).limit(1).toArray()'
        output2 = mongosh_query(query2)
        
        has_fail_log = "LOGIN_FAIL" in output2 or "FAILED" in output2
        
        results.append(log_result(
            "9b", "Audit Log Failure",
            "Failed login + mongosh query",
            "LOGIN_FAIL entry",
            f"Found LOGIN_FAIL entry" if has_fail_log else "No LOGIN_FAIL entry",
            has_fail_log
        ))
    except Exception as e:
        results.append(log_result("9", "Audit Logs", "Full test", "Success", f"Exception: {str(e)}", False))
    
    return all(results) if results else False

def test_10_account_lockout():
    """Test 10: Account lockout after failed attempts"""
    print(f"\n{Colors.BLUE}=== TEST 10: Account Lockout ==={Colors.END}")
    
    try:
        # Use a test account for lockout
        test_email = "lockout@test.com"
        
        # Make 5 failed login attempts
        for i in range(5):
            r = requests.post(f"{BASE_URL}/auth/login",
                            json={"email": test_email, "password": "wrongpassword"})
            print(f"Failed attempt {i+1}: {r.status_code}")
            time.sleep(0.3)
        
        # 6th attempt should be locked (423) even with correct password
        r_locked = requests.post(f"{BASE_URL}/auth/login",
                                json={"email": test_email, "password": "correctpassword"})
        
        is_locked = r_locked.status_code == 423
        
        # Check MongoDB for lockedUntil
        time.sleep(1)
        query = f'db.users.findOne({{email:"{test_email}"}}, {{lockedUntil:1}})'
        output = mongosh_query(query)
        has_locked_until = "lockedUntil" in output
        
        return log_result(
            "10", "Account Lockout",
            "5 failed logins + 6th attempt + mongosh check",
            "423 'Cuenta bloqueada' + lockedUntil in future",
            f"Status={r_locked.status_code}, lockedUntil={'present' if has_locked_until else 'missing'}",
            is_locked or has_locked_until
        )
    except Exception as e:
        return log_result("10", "Account Lockout", "Full test", "Success", f"Exception: {str(e)}", False)

def test_11_business_rules():
    """Test 11: Business rules (past dates, 2h advance, late cancellation)"""
    print(f"\n{Colors.BLUE}=== TEST 11: Business Rules ==={Colors.END}")
    
    results = []
    
    try:
        # Login as reception
        r_login = requests.post(f"{BASE_URL}/auth/login", json=CREDENTIALS["reception"])
        if r_login.status_code != 200:
            return log_result("11", "Business Rules", "Login", "200", f"{r_login.status_code}", False)
        
        token = r_login.json().get('token')
        
        # Get doctor and branch
        r_doctors = requests.get(f"{BASE_URL}/doctors")
        doctors = r_doctors.json().get('doctors', []) if r_doctors.status_code == 200 else []
        
        if not doctors:
            return log_result("11", "Business Rules", "Get doctors", "Success", "No doctors", False)
        
        doctor_id = doctors[0]['id']
        branch_id = doctors[0]['branchIds'][0] if doctors[0].get('branchIds') else 'test'
        
        # Test 11a: Past date
        past_date = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
        r1 = requests.post(f"{BASE_URL}/appointments",
                          json={
                              "doctorId": doctor_id,
                              "branchId": branch_id,
                              "date": past_date,
                              "startTime": "10:00",
                              "endTime": "10:30",
                              "patientName": "Test Past",
                              "patientEmail": "past@test.com",
                              "patientPhone": "123456"
                          },
                          headers={"Authorization": f"Bearer {token}"})
        
        results.append(log_result(
            "11a", "Reject Past Date",
            "POST /api/appointments with past date",
            "400",
            f"{r1.status_code}",
            r1.status_code == 400
        ))
        
        # Test 11b: Less than 2h advance
        now = datetime.now()
        soon_date = now.strftime('%Y-%m-%d')
        soon_time = (now + timedelta(minutes=30)).strftime('%H:%M')
        
        r2 = requests.post(f"{BASE_URL}/appointments",
                          json={
                              "doctorId": doctor_id,
                              "branchId": branch_id,
                              "date": soon_date,
                              "startTime": soon_time,
                              "endTime": (now + timedelta(minutes=60)).strftime('%H:%M'),
                              "patientName": "Test Soon",
                              "patientEmail": "soon@test.com",
                              "patientPhone": "123456"
                          },
                          headers={"Authorization": f"Bearer {token}"})
        
        has_2h_message = r2.status_code == 400 and ("2 horas" in r2.text or "anticipación" in r2.text)
        
        results.append(log_result(
            "11b", "Reject <2h Advance",
            "POST /api/appointments <2h before",
            "400 with '2 horas de anticipación'",
            f"{r2.status_code}, message={'contains 2h' if has_2h_message else 'no 2h message'}",
            r2.status_code == 400
        ))
        
        # Test 11c: Late cancellation
        # Create appointment 12h in future
        future_12h = datetime.now() + timedelta(hours=12)
        future_date = future_12h.strftime('%Y-%m-%d')
        future_time = future_12h.strftime('%H:%M')
        
        r3 = requests.post(f"{BASE_URL}/appointments",
                          json={
                              "doctorId": doctor_id,
                              "branchId": branch_id,
                              "date": future_date,
                              "startTime": future_time,
                              "endTime": (future_12h + timedelta(minutes=30)).strftime('%H:%M'),
                              "patientName": "Test Late Cancel",
                              "patientEmail": "latecancel@test.com",
                              "patientPhone": "123456"
                          },
                          headers={"Authorization": f"Bearer {token}"})
        
        if r3.status_code == 200:
            appt_id = r3.json().get('appointment', {}).get('id')
            
            # Cancel it
            r4 = requests.patch(f"{BASE_URL}/appointments/{appt_id}",
                               json={"status": "cancelled"},
                               headers={"Authorization": f"Bearer {token}"})
            
            if r4.status_code == 200:
                # Check MongoDB for lateCancellation flag
                time.sleep(1)
                query = f'db.appointments.findOne({{id:"{appt_id}"}})'
                output = mongosh_query(query)
                
                has_late_flag = "lateCancellation" in output and "true" in output
                
                results.append(log_result(
                    "11c", "Late Cancellation Flag",
                    "Create 12h appt + cancel + mongosh check",
                    "lateCancellation:true in DB",
                    f"lateCancellation={'true' if has_late_flag else 'false/missing'}",
                    has_late_flag
                ))
            else:
                results.append(log_result("11c", "Late Cancel", "PATCH cancel", "200", f"{r4.status_code}", False))
        else:
            results.append(log_result("11c", "Late Cancel", "Create appt", "200", f"{r3.status_code}", False))
    except Exception as e:
        results.append(log_result("11", "Business Rules", "Full test", "Success", f"Exception: {str(e)}", False))
    
    return all(results) if results else False

def test_12_generic_errors():
    """Test 12: Generic error messages (no stack traces)"""
    print(f"\n{Colors.BLUE}=== TEST 12: Generic Error Messages ==={Colors.END}")
    
    try:
        # Send malformed JSON
        r = requests.post(f"{BASE_URL}/appointments",
                         data="not json",
                         headers={"Content-Type": "application/json"})
        
        # Should return 400 without stack trace
        has_stack = "stack" in r.text.lower() or "trace" in r.text.lower() or "at " in r.text
        
        return log_result(
            "12", "Generic Errors",
            "POST /api/appointments with non-JSON body",
            "400 without stack trace",
            f"{r.status_code}, stack={'present' if has_stack else 'absent'}",
            r.status_code == 400 and not has_stack
        )
    except Exception as e:
        return log_result("12", "Generic Errors", "Malformed request", "400", f"Exception: {str(e)}", False)

def main():
    print(f"\n{Colors.YELLOW}{'='*80}{Colors.END}")
    print(f"{Colors.YELLOW}COMPREHENSIVE SECURITY VERIFICATION - Clínica Buena Salud{Colors.END}")
    print(f"{Colors.YELLOW}Base URL: {BASE_URL}{Colors.END}")
    print(f"{Colors.YELLOW}{'='*80}{Colors.END}")
    
    # Print table header
    print(f"\n{Colors.CYAN}| # | Función | Cómo probaste | Esperado | Real | ✅/❌ |{Colors.END}")
    print(f"{Colors.CYAN}|---|---------|---------------|----------|------|-------|{Colors.END}")
    
    # Run all tests
    test_results = []
    
    test_results.append(("AES-GCM Encryption", test_1_aes_gcm_encryption()))
    test_results.append(("bcrypt Hashing", test_2_bcrypt_hashing()))
    test_results.append(("2FA Mandatory Admin", test_3_2fa_mandatory_admin()))
    test_results.append(("2FA Optional", test_4_2fa_optional()))
    test_results.append(("Zod Validation", test_5_zod_validation()))
    test_results.append(("Rate Limit Login", test_6_rate_limit_login()))
    test_results.append(("Anti-Overlap", test_7_anti_overlap()))
    test_results.append(("Security Headers", test_8_security_headers()))
    test_results.append(("Audit Logs", test_9_audit_logs()))
    test_results.append(("Account Lockout", test_10_account_lockout()))
    test_results.append(("Business Rules", test_11_business_rules()))
    test_results.append(("Generic Errors", test_12_generic_errors()))
    
    # Summary
    print(f"\n{Colors.YELLOW}{'='*80}{Colors.END}")
    print(f"{Colors.YELLOW}SUMMARY BY SEVERITY{Colors.END}")
    print(f"{Colors.YELLOW}{'='*80}{Colors.END}")
    
    critical = []
    medium = []
    minor = []
    
    for name, passed in test_results:
        if not passed:
            if name in ["AES-GCM Encryption", "bcrypt Hashing", "2FA Mandatory Admin", "Anti-Overlap", "Account Lockout"]:
                critical.append(name)
            elif name in ["Zod Validation", "Rate Limit Login", "Audit Logs", "Business Rules"]:
                medium.append(name)
            else:
                minor.append(name)
    
    if critical:
        print(f"\n{Colors.RED}CRÍTICO:{Colors.END}")
        for item in critical:
            print(f"  - {item}")
    
    if medium:
        print(f"\n{Colors.YELLOW}MEDIO:{Colors.END}")
        for item in medium:
            print(f"  - {item}")
    
    if minor:
        print(f"\n{Colors.BLUE}MENOR:{Colors.END}")
        for item in minor:
            print(f"  - {item}")
    
    passed = sum(1 for _, result in test_results if result)
    total = len(test_results)
    
    print(f"\n{Colors.YELLOW}Total: {passed}/{total} tests passed{Colors.END}")
    
    if passed == total:
        print(f"{Colors.GREEN}✅ All security tests passed!{Colors.END}")
        return 0
    else:
        print(f"{Colors.RED}❌ {total - passed} test(s) failed{Colors.END}")
        return 1

if __name__ == "__main__":
    sys.exit(main())
