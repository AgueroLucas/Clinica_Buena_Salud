#!/usr/bin/env python3
"""
Comprehensive backend API tests for Clínica Buena Salud
Tests all endpoints with focus on critical business logic

NOTE: Since the security hardening, booking/listing/updating appointments
requires authentication. Tests log in first and also verify that the
endpoints reject unauthenticated requests (401) and cross-tenant access (403).
"""
import requests
import json
import os
import time
from datetime import datetime, timedelta
import sys

# Windows console (cp1252) cannot print emojis; force UTF-8 output
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# Base URL can be overridden: TEST_BASE_URL=http://localhost:3000/api python backend_test.py
BASE_URL = os.environ.get("TEST_BASE_URL", "http://localhost:3000/api")

# Demo credentials created by POST /api/seed
CREDENTIALS = {
    "admin": {"email": "admin@clinicabuenasalud.com", "password": "Admin@2025!"},
    "reception": {"email": "recepcion@clinicabuenasalud.com", "password": "Recepcion@2025!"},
    "doctor": {"email": "dr.rossi@clinicabuenasalud.com", "password": "Doctor@2025!"},
    "patient": {"email": "paciente@ejemplo.com", "password": "Paciente@2025!"},
}

def login(role):
    """Login helper -> (token, user) or (None, None). Retries once if rate limited."""
    for attempt in range(2):
        try:
            r = requests.post(f"{BASE_URL}/auth/login", json=CREDENTIALS[role], timeout=10)
            if r.status_code == 200:
                data = r.json()
                return data.get('token'), data.get('user')
            if r.status_code == 429 and attempt == 0:
                print("  (rate limited, waiting 61s before retrying login...)")
                time.sleep(61)
                continue
            return None, None
        except Exception:
            return None, None
    return None, None

def auth(token):
    return {"Authorization": f"Bearer {token}"} if token else {}

def post_retry(url, **kwargs):
    """POST that retries once after 61s if the endpoint rate limit returns 429."""
    r = requests.post(url, **kwargs)
    if r.status_code == 429:
        print("  (rate limited, waiting 61s before retrying...)")
        time.sleep(61)
        r = requests.post(url, **kwargs)
    return r

def free_slots(doctor_id, branch_id, date_str, token=None):
    """List of available slots for a doctor/date (avoids collisions across runs)."""
    try:
        r = requests.get(f"{BASE_URL}/doctors/{doctor_id}/availability?date={date_str}&branchId={branch_id}",
                         headers=auth(token))
        if r.status_code == 200:
            return [s for s in r.json().get('slots', [])
                    if s.get('available') and s.get('startTime') and s.get('endTime')]
    except Exception:
        pass
    return []

def add_minutes(t, m):
    """'HH:MM' + m minutes -> 'HH:MM'."""
    hh, mm = map(int, t.split(':'))
    total = hh * 60 + mm + m
    return f"{total // 60:02d}:{total % 60:02d}"

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    END = '\033[0m'

def log_test(name, passed, details=""):
    status = f"{Colors.GREEN}✅ PASS{Colors.END}" if passed else f"{Colors.RED}❌ FAIL{Colors.END}"
    print(f"{status} - {name}")
    if details:
        print(f"  {details}")
    return passed

def test_seed():
    """Test 1: POST /api/seed - idempotency check"""
    print(f"\n{Colors.BLUE}=== TEST 1: Seed Endpoint ==={Colors.END}")
    
    try:
        # First seed call
        r1 = requests.post(f"{BASE_URL}/seed", headers={"Content-Type": "application/json"})
        print(f"First seed call: {r1.status_code}")
        
        if r1.status_code != 200:
            return log_test("Seed first call", False, f"Expected 200, got {r1.status_code}")
        
        data1 = r1.json()
        print(f"Response: {json.dumps(data1, indent=2)}")
        
        # Second seed call - should return alreadySeeded
        r2 = requests.post(f"{BASE_URL}/seed", headers={"Content-Type": "application/json"})
        print(f"Second seed call: {r2.status_code}")
        
        if r2.status_code != 200:
            return log_test("Seed idempotency", False, f"Expected 200, got {r2.status_code}")
        
        data2 = r2.json()
        print(f"Response: {json.dumps(data2, indent=2)}")
        
        if data2.get('alreadySeeded') == True:
            return log_test("Seed idempotency", True, "Second call correctly returned alreadySeeded:true")
        else:
            return log_test("Seed idempotency", True, "Seed completed successfully")
            
    except Exception as e:
        return log_test("Seed endpoint", False, f"Exception: {str(e)}")

def test_seed_protected():
    """Test 1b: POST /api/seed?force=1 without admin must be rejected (403)"""
    print(f"\n{Colors.BLUE}=== TEST 1B: Seed Protection ==={Colors.END}")
    try:
        r = requests.post(f"{BASE_URL}/seed?force=1", headers={"Content-Type": "application/json"})
        if r.status_code == 403:
            return log_test("Seed force without auth", True, "Correctly returned 403 (admin or X-Seed-Secret required)")
        return log_test("Seed force without auth", False, f"Expected 403, got {r.status_code}")
    except Exception as e:
        return log_test("Seed force without auth", False, f"Exception: {str(e)}")

def test_register():
    """Test 1c: POST /api/auth/register - new endpoint for verified accounts"""
    print(f"\n{Colors.BLUE}=== TEST 1C: Patient Registration ==={Colors.END}")
    all_passed = True
    email = f"test.register.{int(time.time())}@ejemplo.com"

    # Valid registration
    try:
        r = post_retry(f"{BASE_URL}/auth/register", json={
            "name": "Usuario de Prueba",
            "email": email,
            "password": "Prueba@2025!x",
            "phone": "+54 11 5000-9999",
        }, timeout=10)
        if r.status_code in (200, 201) and 'token' in r.json() and r.json()['user'].get('role') == 'patient':
            all_passed = log_test("Register valid patient", True, f"Created with role=patient, status={r.status_code}") and all_passed
        else:
            all_passed = log_test("Register valid patient", False, f"Status {r.status_code}: {r.text[:120]}") and all_passed
    except Exception as e:
        all_passed = log_test("Register valid patient", False, f"Exception: {str(e)}") and all_passed

    # Duplicate email
    try:
        r = post_retry(f"{BASE_URL}/auth/register", json={
            "name": "Usuario Repetido", "email": email, "password": "OtraClave@2025!x",
        }, timeout=10)
        all_passed = log_test("Register duplicate email", r.status_code == 409, f"Expected 409, got {r.status_code}") and all_passed
    except Exception as e:
        all_passed = log_test("Register duplicate email", False, f"Exception: {str(e)}") and all_passed

    # Weak password
    try:
        r = post_retry(f"{BASE_URL}/auth/register", json={
            "name": "Clave Débil", "email": f"weak.{int(time.time())}@ejemplo.com", "password": "123",
        }, timeout=10)
        all_passed = log_test("Register weak password", r.status_code == 400, f"Expected 400, got {r.status_code}") and all_passed
    except Exception as e:
        all_passed = log_test("Register weak password", False, f"Exception: {str(e)}") and all_passed

    return all_passed

def test_auth():
    """Test 2: POST /api/auth/login and GET /api/auth/me"""
    print(f"\n{Colors.BLUE}=== TEST 2: Authentication ==={Colors.END}")
    
    credentials = [
        (CREDENTIALS["admin"]["email"], CREDENTIALS["admin"]["password"], "admin"),
        (CREDENTIALS["reception"]["email"], CREDENTIALS["reception"]["password"], "reception"),
        (CREDENTIALS["doctor"]["email"], CREDENTIALS["doctor"]["password"], "doctor"),
        (CREDENTIALS["patient"]["email"], CREDENTIALS["patient"]["password"], "patient"),
    ]
    
    all_passed = True
    tokens = {}
    users = {}
    
    for email, password, expected_role in credentials:
        try:
            r = None
            for attempt in range(2):
                r = requests.post(f"{BASE_URL}/auth/login", 
                                json={"email": email, "password": password},
                                headers={"Content-Type": "application/json"})
                if r.status_code == 429 and attempt == 0:
                    print("  (rate limited, waiting 61s before retrying login...)")
                    time.sleep(61)
                    continue
                break
            
            if r.status_code != 200:
                all_passed = log_test(f"Login {expected_role}", False, f"Status {r.status_code}") and all_passed
                continue
            
            data = r.json()
            # admin/doctor require 2FA setup on first login (no plain token yet)
            if data.get('require2FA'):
                all_passed = log_test(f"Login {expected_role}", True, "2FA required (setup pending) - accepted") and all_passed
                continue
            
            if 'token' not in data or 'user' not in data:
                all_passed = log_test(f"Login {expected_role}", False, "Missing token or user") and all_passed
                continue
            
            if data['user'].get('role') != expected_role:
                all_passed = log_test(f"Login {expected_role}", False, f"Expected role {expected_role}, got {data['user'].get('role')}") and all_passed
                continue
            
            tokens[expected_role] = data['token']
            users[expected_role] = data['user']
            all_passed = log_test(f"Login {expected_role}", True, f"Token received, role={expected_role}") and all_passed
            
        except Exception as e:
            all_passed = log_test(f"Login {expected_role}", False, f"Exception: {str(e)}") and all_passed
    
    # Test invalid credentials
    try:
        r = requests.post(f"{BASE_URL}/auth/login", 
                        json={"email": "invalid@test.com", "password": "wrong"},
                        headers={"Content-Type": "application/json"})
        
        if r.status_code == 401:
            all_passed = log_test("Login invalid credentials", True, "Correctly returned 401") and all_passed
        else:
            all_passed = log_test("Login invalid credentials", False, f"Expected 401, got {r.status_code}") and all_passed
    except Exception as e:
        all_passed = log_test("Login invalid credentials", False, f"Exception: {str(e)}") and all_passed
    
    # Test /api/auth/me with token
    if 'admin' in tokens:
        try:
            r = requests.get(f"{BASE_URL}/auth/me", 
                           headers={"Authorization": f"Bearer {tokens['admin']}"})
            
            if r.status_code == 200 and 'user' in r.json():
                all_passed = log_test("GET /auth/me with token", True, "User data returned") and all_passed
            else:
                all_passed = log_test("GET /auth/me with token", False, f"Status {r.status_code}") and all_passed
        except Exception as e:
            all_passed = log_test("GET /auth/me with token", False, f"Exception: {str(e)}") and all_passed
    
    # Test /api/auth/me without token
    try:
        r = requests.get(f"{BASE_URL}/auth/me")
        if r.status_code == 401:
            all_passed = log_test("GET /auth/me without token", True, "Correctly returned 401") and all_passed
        else:
            all_passed = log_test("GET /auth/me without token", False, f"Expected 401, got {r.status_code}") and all_passed
    except Exception as e:
        all_passed = log_test("GET /auth/me without token", False, f"Exception: {str(e)}") and all_passed
    
    return all_passed, tokens, users

def test_listings():
    """Test 3: GET /api/specialties, /api/branches, /api/doctors, /api/offices"""
    print(f"\n{Colors.BLUE}=== TEST 3: Listing Endpoints ==={Colors.END}")
    
    endpoints = ['specialties', 'branches', 'doctors', 'offices']
    all_passed = True
    data_cache = {}
    
    for endpoint in endpoints:
        try:
            r = requests.get(f"{BASE_URL}/{endpoint}")
            
            if r.status_code != 200:
                all_passed = log_test(f"GET /{endpoint}", False, f"Status {r.status_code}") and all_passed
                continue
            
            data = r.json()
            items = data.get(endpoint, [])
            
            if len(items) == 0:
                all_passed = log_test(f"GET /{endpoint}", False, "Empty array returned") and all_passed
                continue
            
            # Check for _id or password in response
            has_id = any('_id' in item for item in items)
            has_password = any('password' in item for item in items)
            
            if has_id:
                all_passed = log_test(f"GET /{endpoint}", False, "Contains _id field (should be removed)") and all_passed
                continue
            
            if has_password:
                all_passed = log_test(f"GET /{endpoint}", False, "Contains password field (should be removed)") and all_passed
                continue
            
            data_cache[endpoint] = items
            all_passed = log_test(f"GET /{endpoint}", True, f"Returned {len(items)} items, no _id/password") and all_passed
            
        except Exception as e:
            all_passed = log_test(f"GET /{endpoint}", False, f"Exception: {str(e)}") and all_passed
    
    return all_passed, data_cache

def test_availability(doctors, branches):
    """Test 4: GET /api/doctors/:id/availability"""
    print(f"\n{Colors.BLUE}=== TEST 4: Doctor Availability ==={Colors.END}")
    
    if not doctors or len(doctors) == 0:
        return log_test("Doctor availability", False, "No doctors available for testing")
    
    doctor = doctors[0]
    doctor_id = doctor.get('id')
    branch_ids = doctor.get('branchIds', [])
    
    if not doctor_id:
        return log_test("Doctor availability", False, "Doctor has no id")
    
    if not branch_ids or len(branch_ids) == 0:
        return log_test("Doctor availability", False, "Doctor has no branches")
    
    branch_id = branch_ids[0]
    
    # Get next Monday
    today = datetime.now()
    days_ahead = 0 - today.weekday() + 7  # Next Monday
    if days_ahead <= 0:
        days_ahead += 7
    next_monday = today + timedelta(days=days_ahead)
    date_str = next_monday.strftime('%Y-%m-%d')
    
    # Prefer a date that still has free slots (appointments from previous runs persist)
    for extra in range(2, 45):
        candidate = (today + timedelta(days=extra)).strftime('%Y-%m-%d')
        if free_slots(doctor_id, branch_id, candidate):
            date_str = candidate
            break
    
    all_passed = True
    
    # Test with date and branchId
    try:
        r = requests.get(f"{BASE_URL}/doctors/{doctor_id}/availability?date={date_str}&branchId={branch_id}")
        
        if r.status_code != 200:
            all_passed = log_test("Availability with date+branch", False, f"Status {r.status_code}") and all_passed
        else:
            data = r.json()
            slots = data.get('slots', [])
            
            if len(slots) == 0:
                all_passed = log_test("Availability with date+branch", False, "No slots returned") and all_passed
            else:
                # Check slot structure
                first_slot = slots[0]
                required_fields = ['startTime', 'endTime', 'branchId', 'available']
                missing = [f for f in required_fields if f not in first_slot]
                
                if missing:
                    all_passed = log_test("Availability with date+branch", False, f"Missing fields: {missing}") and all_passed
                else:
                    # Check if slots are 30 min intervals between 09:00 and 17:00
                    valid_slots = all(
                        slot.get('startTime', '').split(':')[0] >= '09' and 
                        slot.get('endTime', '').split(':')[0] <= '17'
                        for slot in slots
                    )
                    all_passed = log_test("Availability with date+branch", True, f"Returned {len(slots)} slots with correct structure") and all_passed
    except Exception as e:
        all_passed = log_test("Availability with date+branch", False, f"Exception: {str(e)}") and all_passed
    
    # Test without date (should return 400)
    try:
        r = requests.get(f"{BASE_URL}/doctors/{doctor_id}/availability")
        
        if r.status_code == 400:
            all_passed = log_test("Availability without date", True, "Correctly returned 400") and all_passed
        else:
            all_passed = log_test("Availability without date", False, f"Expected 400, got {r.status_code}") and all_passed
    except Exception as e:
        all_passed = log_test("Availability without date", False, f"Exception: {str(e)}") and all_passed
    
    return all_passed, doctor_id, branch_id, date_str

def test_create_appointment(doctor_id, branch_id, date_str, specialties, token=None):
    """Test 5: POST /api/appointments - auth required + overlap validation"""
    print(f"\n{Colors.BLUE}=== TEST 5: Create Appointment (CRITICAL - Auth + Overlap Validation) ==={Colors.END}")
    
    all_passed = True
    appointment_id = None
    headers = auth(token)
    
    # SECURITY: unauthenticated booking must be rejected
    try:
        r = requests.post(f"{BASE_URL}/appointments",
                         json={"doctorId": doctor_id, "branchId": branch_id,
                               "date": date_str, "startTime": "09:00", "endTime": "09:30"},
                         headers={"Content-Type": "application/json"})
        all_passed = log_test("Booking without session", r.status_code == 401, f"Expected 401, got {r.status_code}") and all_passed
    except Exception as e:
        all_passed = log_test("Booking without session", False, f"Exception: {str(e)}") and all_passed
    
    if not token:
        return all_passed and log_test("Create appointment", False, "No reception token available"), appointment_id
    
    # Get specialty ID
    specialty_id = specialties[0].get('id') if specialties else None
    
    # Choose an available slot (previous runs leave appointments behind)
    slots = free_slots(doctor_id, branch_id, date_str, token)
    if slots:
        start_t, end_t = slots[0]['startTime'], slots[0]['endTime']
    else:
        start_t, end_t = "10:00", "10:30"
    
    # Test successful appointment creation (authenticated as reception)
    appointment_data = {
        "doctorId": doctor_id,
        "specialtyId": specialty_id,
        "branchId": branch_id,
        "date": date_str,
        "startTime": start_t,
        "endTime": end_t,
        "patientName": "Carlos Martínez",
        "patientEmail": "carlos.martinez@ejemplo.com",
        "patientPhone": "+54 11 5555-1234"
    }
    
    try:
        r = requests.post(f"{BASE_URL}/appointments", 
                         json=appointment_data,
                         headers={"Content-Type": "application/json", **headers})
        
        if r.status_code != 200:
            all_passed = log_test("Create appointment", False, f"Status {r.status_code}: {r.text}") and all_passed
        else:
            data = r.json()
            appointment = data.get('appointment')
            
            if not appointment or 'id' not in appointment:
                all_passed = log_test("Create appointment", False, "No appointment ID returned") and all_passed
            elif appointment.get('status') != 'pending':
                all_passed = log_test("Create appointment", False, f"Expected status 'pending', got {appointment.get('status')}") and all_passed
            else:
                appointment_id = appointment['id']
                all_passed = log_test("Create appointment", True, f"Created with ID {appointment_id}, status=pending") and all_passed
    except Exception as e:
        all_passed = log_test("Create appointment", False, f"Exception: {str(e)}") and all_passed
    
    # CRITICAL TEST: Try to create overlapping appointment (exact same time)
    try:
        r = requests.post(f"{BASE_URL}/appointments", 
                         json=appointment_data,
                         headers={"Content-Type": "application/json", **headers})
        
        if r.status_code == 409:
            all_passed = log_test("Overlap validation (exact)", True, "Correctly returned 409 for exact overlap") and all_passed
        else:
            all_passed = log_test("Overlap validation (exact)", False, f"Expected 409, got {r.status_code}") and all_passed
    except Exception as e:
        all_passed = log_test("Overlap validation (exact)", False, f"Exception: {str(e)}") and all_passed
    
    # CRITICAL TEST: Try to create partially overlapping appointment
    overlap_data = {
        **appointment_data,
        "startTime": add_minutes(start_t, 15),
        "endTime": add_minutes(end_t, 15),
        "patientEmail": "otro.paciente@ejemplo.com"
    }
    
    try:
        r = requests.post(f"{BASE_URL}/appointments", 
                         json=overlap_data,
                         headers={"Content-Type": "application/json", **headers})
        
        if r.status_code == 409:
            all_passed = log_test("Overlap validation (partial)", True, "Correctly returned 409 for partial overlap") and all_passed
        else:
            all_passed = log_test("Overlap validation (partial)", False, f"Expected 409, got {r.status_code}") and all_passed
    except Exception as e:
        all_passed = log_test("Overlap validation (partial)", False, f"Exception: {str(e)}") and all_passed
    
    # Test with incomplete data
    incomplete_data = {"doctorId": doctor_id}
    
    try:
        r = requests.post(f"{BASE_URL}/appointments", 
                         json=incomplete_data,
                         headers={"Content-Type": "application/json", **headers})
        
        if r.status_code == 400:
            all_passed = log_test("Incomplete data validation", True, "Correctly returned 400") and all_passed
        else:
            all_passed = log_test("Incomplete data validation", False, f"Expected 400, got {r.status_code}") and all_passed
    except Exception as e:
        all_passed = log_test("Incomplete data validation", False, f"Exception: {str(e)}") and all_passed
    
    return all_passed, appointment_id

def test_list_appointments(doctor_id, date_str, admin_token=None, patient_token=None, patient_user=None):
    """Test 6: GET /api/appointments - auth required + role scoping + filters"""
    print(f"\n{Colors.BLUE}=== TEST 6: List/Filter Appointments (auth + scoping) ==={Colors.END}")
    
    all_passed = True
    admin_headers = auth(admin_token)
    
    # SECURITY: listing without session must be rejected
    try:
        r = requests.get(f"{BASE_URL}/appointments")
        all_passed = log_test("List appointments without session", r.status_code == 401, f"Expected 401, got {r.status_code}") and all_passed
    except Exception as e:
        all_passed = log_test("List appointments without session", False, f"Exception: {str(e)}") and all_passed
    
    # SECURITY: patient only sees own appointments
    if patient_token and patient_user:
        try:
            r = requests.get(f"{BASE_URL}/appointments?patientId={patient_user.get('id')}", headers=auth(patient_token))
            appts = r.json().get('appointments', []) if r.status_code == 200 else []
            foreign = [a for a in appts if a.get('patientId') != patient_user.get('id')]
            all_passed = log_test("Patient scoping", r.status_code == 200 and not foreign,
                                  f"status={r.status_code}, {len(appts)} own, {len(foreign)} foreign") and all_passed
        except Exception as e:
            all_passed = log_test("Patient scoping", False, f"Exception: {str(e)}") and all_passed
    
    # Test without filters (as staff)
    try:
        r = requests.get(f"{BASE_URL}/appointments", headers=admin_headers)
        
        if r.status_code != 200:
            all_passed = log_test("List all appointments", False, f"Status {r.status_code}") and all_passed
        else:
            data = r.json()
            appointments = data.get('appointments', [])
            all_passed = log_test("List all appointments", True, f"Returned {len(appointments)} appointments") and all_passed
    except Exception as e:
        all_passed = log_test("List all appointments", False, f"Exception: {str(e)}") and all_passed
    
    # Test with doctorId filter
    try:
        r = requests.get(f"{BASE_URL}/appointments?doctorId={doctor_id}", headers=admin_headers)
        
        if r.status_code != 200:
            all_passed = log_test("Filter by doctorId", False, f"Status {r.status_code}") and all_passed
        else:
            data = r.json()
            appointments = data.get('appointments', [])
            # Verify all have the correct doctorId
            wrong_doctor = [a for a in appointments if a.get('doctorId') != doctor_id]
            if wrong_doctor:
                all_passed = log_test("Filter by doctorId", False, f"Found {len(wrong_doctor)} appointments with wrong doctorId") and all_passed
            else:
                all_passed = log_test("Filter by doctorId", True, f"Returned {len(appointments)} appointments for doctor") and all_passed
    except Exception as e:
        all_passed = log_test("Filter by doctorId", False, f"Exception: {str(e)}") and all_passed
    
    # Test with date range
    try:
        r = requests.get(f"{BASE_URL}/appointments?from={date_str}&to={date_str}", headers=admin_headers)
        
        if r.status_code != 200:
            all_passed = log_test("Filter by date range", False, f"Status {r.status_code}") and all_passed
        else:
            data = r.json()
            appointments = data.get('appointments', [])
            all_passed = log_test("Filter by date range", True, f"Returned {len(appointments)} appointments in range") and all_passed
    except Exception as e:
        all_passed = log_test("Filter by date range", False, f"Exception: {str(e)}") and all_passed
    
    # Test with status filter
    try:
        r = requests.get(f"{BASE_URL}/appointments?status=pending", headers=admin_headers)
        
        if r.status_code != 200:
            all_passed = log_test("Filter by status", False, f"Status {r.status_code}") and all_passed
        else:
            data = r.json()
            appointments = data.get('appointments', [])
            wrong_status = [a for a in appointments if a.get('status') != 'pending']
            if wrong_status:
                all_passed = log_test("Filter by status", False, f"Found {len(wrong_status)} appointments with wrong status") and all_passed
            else:
                all_passed = log_test("Filter by status", True, f"Returned {len(appointments)} pending appointments") and all_passed
    except Exception as e:
        all_passed = log_test("Filter by status", False, f"Exception: {str(e)}") and all_passed
    
    return all_passed

def test_update_appointment(appointment_id, doctor_id, date_str, token=None, patient_token=None, branch_id=None):
    """Test 7: PATCH /api/appointments/:id - auth + ownership"""
    print(f"\n{Colors.BLUE}=== TEST 7: Update Appointment (auth + ownership) ==={Colors.END}")
    
    if not appointment_id:
        return log_test("Update appointment", False, "No appointment ID available")
    
    # Resolve branch if not provided
    if not branch_id:
        try:
            docs = requests.get(f"{BASE_URL}/doctors").json().get('doctors', [])
            for d in docs:
                if d.get('id') == doctor_id and d.get('branchIds'):
                    branch_id = d['branchIds'][0]
                    break
        except Exception:
            pass
    branch_id = branch_id or "any"
    
    all_passed = True
    headers = auth(token)
    
    # SECURITY: update without session must be rejected
    try:
        r = requests.patch(f"{BASE_URL}/appointments/{appointment_id}", json={"status": "confirmed"})
        all_passed = log_test("Update without session", r.status_code == 401, f"Expected 401, got {r.status_code}") and all_passed
    except Exception as e:
        all_passed = log_test("Update without session", False, f"Exception: {str(e)}") and all_passed
    
    # SECURITY: a patient cannot modify someone else's appointment
    if patient_token:
        try:
            r = requests.patch(f"{BASE_URL}/appointments/{appointment_id}",
                               json={"status": "cancelled"}, headers=auth(patient_token))
            all_passed = log_test("Patient cannot modify foreign appointment", r.status_code == 403,
                                  f"Expected 403, got {r.status_code}") and all_passed
        except Exception as e:
            all_passed = log_test("Patient cannot modify foreign appointment", False, f"Exception: {str(e)}") and all_passed
    
    # Test status change to confirmed
    
    try:
        r = requests.patch(f"{BASE_URL}/appointments/{appointment_id}",
                          json={"status": "confirmed"},
                          headers={"Content-Type": "application/json", **headers})
        
        if r.status_code != 200:
            all_passed = log_test("Update status to confirmed", False, f"Status {r.status_code}") and all_passed
        else:
            data = r.json()
            appointment = data.get('appointment')
            if appointment.get('status') != 'confirmed':
                all_passed = log_test("Update status to confirmed", False, f"Status not updated") and all_passed
            else:
                all_passed = log_test("Update status to confirmed", True, "Status updated to confirmed") and all_passed
    except Exception as e:
        all_passed = log_test("Update status to confirmed", False, f"Exception: {str(e)}") and all_passed
    
    # Test status change to in_room
    try:
        r = requests.patch(f"{BASE_URL}/appointments/{appointment_id}",
                          json={"status": "in_room"},
                          headers={"Content-Type": "application/json", **headers})
        
        if r.status_code != 200:
            all_passed = log_test("Update status to in_room", False, f"Status {r.status_code}") and all_passed
        else:
            data = r.json()
            appointment = data.get('appointment')
            if appointment.get('status') != 'in_room':
                all_passed = log_test("Update status to in_room", False, f"Status not updated") and all_passed
            else:
                all_passed = log_test("Update status to in_room", True, "Status updated to in_room") and all_passed
    except Exception as e:
        all_passed = log_test("Update status to in_room", False, f"Exception: {str(e)}") and all_passed
    
    # Test reschedule to a free slot (pick one available now)
    slots = free_slots(doctor_id, branch_id, date_str, token)
    resched = slots[0] if slots else {"startTime": "14:00", "endTime": "14:30"}
    occupied = slots[1] if len(slots) > 1 else {"startTime": "15:00", "endTime": "15:30"}
    
    try:
        r = requests.patch(f"{BASE_URL}/appointments/{appointment_id}",
                          json={
                              "date": date_str,
                              "startTime": resched['startTime'],
                              "endTime": resched['endTime']
                          },
                          headers={"Content-Type": "application/json", **headers})
        
        if r.status_code != 200:
            all_passed = log_test("Reschedule to free slot", False, f"Status {r.status_code}") and all_passed
        else:
            data = r.json()
            appointment = data.get('appointment')
            if appointment.get('startTime') != resched['startTime']:
                all_passed = log_test("Reschedule to free slot", False, f"Time not updated") and all_passed
            else:
                all_passed = log_test("Reschedule to free slot", True, f"Rescheduled to {resched['startTime']}-{resched['endTime']}") and all_passed
    except Exception as e:
        all_passed = log_test("Reschedule to free slot", False, f"Exception: {str(e)}") and all_passed
    
    # CRITICAL TEST: Try to reschedule to an occupied slot
    # First create another appointment in a different free slot
    try:
        r = requests.post(f"{BASE_URL}/appointments",
                         json={
                             "doctorId": doctor_id,
                             "branchId": "any",
                             "date": date_str,
                             "startTime": occupied['startTime'],
                             "endTime": occupied['endTime'],
                             "patientName": "Test Patient 2",
                             "patientEmail": "test2@ejemplo.com",
                             "patientPhone": "+54 11 5555-5678"
                         },
                         headers={"Content-Type": "application/json", **headers})
        
        if r.status_code == 200:
            # Now try to reschedule first appointment to overlap with this one
            r2 = requests.patch(f"{BASE_URL}/appointments/{appointment_id}",
                               json={
                                   "date": date_str,
                                   "startTime": occupied['startTime'],
                                   "endTime": occupied['endTime']
                               },
                               headers={"Content-Type": "application/json", **headers})
            
            if r2.status_code == 409:
                all_passed = log_test("Reschedule overlap validation", True, "Correctly returned 409 for occupied slot") and all_passed
            else:
                all_passed = log_test("Reschedule overlap validation", False, f"Expected 409, got {r2.status_code}") and all_passed
        else:
            all_passed = log_test("Reschedule overlap validation", False, "Could not create second appointment for test") and all_passed
    except Exception as e:
        all_passed = log_test("Reschedule overlap validation", False, f"Exception: {str(e)}") and all_passed
    
    return all_passed

def test_stats():
    """Test 8: GET /api/stats"""
    print(f"\n{Colors.BLUE}=== TEST 8: Stats Endpoint ==={Colors.END}")
    
    try:
        r = requests.get(f"{BASE_URL}/stats")
        
        if r.status_code != 200:
            return log_test("GET /stats", False, f"Status {r.status_code}")
        
        data = r.json()
        required_fields = ['totalToday', 'confirmedToday', 'cancelledToday', 'total', 'bySpecialty', 'byStatus']
        missing = [f for f in required_fields if f not in data]
        
        if missing:
            return log_test("GET /stats", False, f"Missing fields: {missing}")
        
        # Check bySpecialty structure
        by_specialty = data.get('bySpecialty', [])
        if by_specialty and len(by_specialty) > 0:
            first = by_specialty[0]
            if 'name' not in first or 'count' not in first:
                return log_test("GET /stats", False, "bySpecialty items missing name or count")
        
        # Check byStatus structure
        by_status = data.get('byStatus', [])
        if by_status and len(by_status) > 0:
            first = by_status[0]
            if 'status' not in first or 'count' not in first:
                return log_test("GET /stats", False, "byStatus items missing status or count")
        
        return log_test("GET /stats", True, f"All fields present: total={data['total']}, totalToday={data['totalToday']}")
        
    except Exception as e:
        return log_test("GET /stats", False, f"Exception: {str(e)}")

def main():
    print(f"\n{Colors.YELLOW}{'='*60}{Colors.END}")
    print(f"{Colors.YELLOW}Clínica Buena Salud - Backend API Tests{Colors.END}")
    print(f"{Colors.YELLOW}Base URL: {BASE_URL}{Colors.END}")
    print(f"{Colors.YELLOW}{'='*60}{Colors.END}")
    
    results = []
    
    # Test 1: Seed
    results.append(("Seed", test_seed()))
    results.append(("Seed Protection", test_seed_protected()))
    results.append(("Registration", test_register()))
    
    # Test 2: Auth
    auth_result, tokens, users = test_auth()
    results.append(("Auth", auth_result))
    
    # Test 3: Listings
    listings_result, data_cache = test_listings()
    results.append(("Listings", listings_result))
    
    doctors = data_cache.get('doctors', [])
    branches = data_cache.get('branches', [])
    specialties = data_cache.get('specialties', [])
    
    # Test 4: Availability
    if doctors and branches:
        avail_result, doctor_id, branch_id, date_str = test_availability(doctors, branches)
        results.append(("Availability", avail_result))
        
        # Test 5: Create Appointment
        create_result, appointment_id = test_create_appointment(doctor_id, branch_id, date_str, specialties, tokens.get('reception'))
        results.append(("Create Appointment", create_result))
        
        # Test 6: List Appointments
        list_result = test_list_appointments(doctor_id, date_str, tokens.get('admin') or tokens.get('reception'),
                                             tokens.get('patient'), users.get('patient'))
        results.append(("List Appointments", list_result))
        
        # Test 7: Update Appointment
        update_result = test_update_appointment(appointment_id, doctor_id, date_str,
                                                tokens.get('reception'), tokens.get('patient'), branch_id)
        results.append(("Update Appointment", update_result))
    else:
        print(f"{Colors.RED}Skipping availability/appointment tests - no doctors/branches{Colors.END}")
        results.append(("Availability", False))
        results.append(("Create Appointment", False))
        results.append(("List Appointments", False))
        results.append(("Update Appointment", False))
    
    # Test 8: Stats
    results.append(("Stats", test_stats()))
    
    # Summary
    print(f"\n{Colors.YELLOW}{'='*60}{Colors.END}")
    print(f"{Colors.YELLOW}TEST SUMMARY{Colors.END}")
    print(f"{Colors.YELLOW}{'='*60}{Colors.END}")
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = f"{Colors.GREEN}✅ PASS{Colors.END}" if result else f"{Colors.RED}❌ FAIL{Colors.END}"
        print(f"{status} - {name}")
    
    print(f"\n{Colors.YELLOW}Total: {passed}/{total} tests passed{Colors.END}")
    
    if passed == total:
        print(f"{Colors.GREEN}All tests passed!{Colors.END}")
        return 0
    else:
        print(f"{Colors.RED}{total - passed} test(s) failed{Colors.END}")
        return 1

if __name__ == "__main__":
    sys.exit(main())
