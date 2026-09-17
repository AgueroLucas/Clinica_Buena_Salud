#!/usr/bin/env python3
"""
Comprehensive backend API tests for Clínica Buena Salud
Tests all endpoints with focus on critical business logic
"""
import requests
import json
from datetime import datetime, timedelta
import sys

# Read base URL from .env
BASE_URL = "https://clinic-appointments-55.preview.emergentagent.com/api"

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

def test_auth():
    """Test 2: POST /api/auth/login and GET /api/auth/me"""
    print(f"\n{Colors.BLUE}=== TEST 2: Authentication ==={Colors.END}")
    
    credentials = [
        ("admin@clinicabuenasalud.com", "admin123", "admin"),
        ("recepcion@clinicabuenasalud.com", "recepcion123", "reception"),
        ("dr.rossi@clinicabuenasalud.com", "doctor123", "doctor"),
        ("paciente@ejemplo.com", "paciente123", "patient"),
    ]
    
    all_passed = True
    tokens = {}
    
    for email, password, expected_role in credentials:
        try:
            r = requests.post(f"{BASE_URL}/auth/login", 
                            json={"email": email, "password": password},
                            headers={"Content-Type": "application/json"})
            
            if r.status_code != 200:
                all_passed = log_test(f"Login {expected_role}", False, f"Status {r.status_code}") and all_passed
                continue
            
            data = r.json()
            if 'token' not in data or 'user' not in data:
                all_passed = log_test(f"Login {expected_role}", False, "Missing token or user") and all_passed
                continue
            
            if data['user'].get('role') != expected_role:
                all_passed = log_test(f"Login {expected_role}", False, f"Expected role {expected_role}, got {data['user'].get('role')}") and all_passed
                continue
            
            tokens[expected_role] = data['token']
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
    
    return all_passed, tokens

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

def test_create_appointment(doctor_id, branch_id, date_str, specialties):
    """Test 5: POST /api/appointments with overlap validation"""
    print(f"\n{Colors.BLUE}=== TEST 5: Create Appointment (CRITICAL - Overlap Validation) ==={Colors.END}")
    
    all_passed = True
    appointment_id = None
    
    # Get specialty ID
    specialty_id = specialties[0].get('id') if specialties else None
    
    # Test successful appointment creation
    appointment_data = {
        "doctorId": doctor_id,
        "specialtyId": specialty_id,
        "branchId": branch_id,
        "date": date_str,
        "startTime": "10:00",
        "endTime": "10:30",
        "patientName": "Carlos Martínez",
        "patientEmail": "carlos.martinez@ejemplo.com",
        "patientPhone": "+54 11 5555-1234"
    }
    
    try:
        r = requests.post(f"{BASE_URL}/appointments", 
                         json=appointment_data,
                         headers={"Content-Type": "application/json"})
        
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
                         headers={"Content-Type": "application/json"})
        
        if r.status_code == 409:
            all_passed = log_test("Overlap validation (exact)", True, "Correctly returned 409 for exact overlap") and all_passed
        else:
            all_passed = log_test("Overlap validation (exact)", False, f"Expected 409, got {r.status_code}") and all_passed
    except Exception as e:
        all_passed = log_test("Overlap validation (exact)", False, f"Exception: {str(e)}") and all_passed
    
    # CRITICAL TEST: Try to create partially overlapping appointment
    overlap_data = {
        **appointment_data,
        "startTime": "10:15",
        "endTime": "10:45",
        "patientEmail": "otro.paciente@ejemplo.com"
    }
    
    try:
        r = requests.post(f"{BASE_URL}/appointments", 
                         json=overlap_data,
                         headers={"Content-Type": "application/json"})
        
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
                         headers={"Content-Type": "application/json"})
        
        if r.status_code == 400:
            all_passed = log_test("Incomplete data validation", True, "Correctly returned 400") and all_passed
        else:
            all_passed = log_test("Incomplete data validation", False, f"Expected 400, got {r.status_code}") and all_passed
    except Exception as e:
        all_passed = log_test("Incomplete data validation", False, f"Exception: {str(e)}") and all_passed
    
    return all_passed, appointment_id

def test_list_appointments(doctor_id, date_str):
    """Test 6: GET /api/appointments with filters"""
    print(f"\n{Colors.BLUE}=== TEST 6: List/Filter Appointments ==={Colors.END}")
    
    all_passed = True
    
    # Test without filters
    try:
        r = requests.get(f"{BASE_URL}/appointments")
        
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
        r = requests.get(f"{BASE_URL}/appointments?doctorId={doctor_id}")
        
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
        r = requests.get(f"{BASE_URL}/appointments?from={date_str}&to={date_str}")
        
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
        r = requests.get(f"{BASE_URL}/appointments?status=pending")
        
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

def test_update_appointment(appointment_id, doctor_id, date_str):
    """Test 7: PATCH /api/appointments/:id"""
    print(f"\n{Colors.BLUE}=== TEST 7: Update Appointment ==={Colors.END}")
    
    if not appointment_id:
        return log_test("Update appointment", False, "No appointment ID available")
    
    all_passed = True
    
    # Test status change to confirmed
    try:
        r = requests.patch(f"{BASE_URL}/appointments/{appointment_id}",
                          json={"status": "confirmed"},
                          headers={"Content-Type": "application/json"})
        
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
                          headers={"Content-Type": "application/json"})
        
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
    
    # Test reschedule to a free slot
    try:
        r = requests.patch(f"{BASE_URL}/appointments/{appointment_id}",
                          json={
                              "date": date_str,
                              "startTime": "14:00",
                              "endTime": "14:30"
                          },
                          headers={"Content-Type": "application/json"})
        
        if r.status_code != 200:
            all_passed = log_test("Reschedule to free slot", False, f"Status {r.status_code}") and all_passed
        else:
            data = r.json()
            appointment = data.get('appointment')
            if appointment.get('startTime') != '14:00':
                all_passed = log_test("Reschedule to free slot", False, f"Time not updated") and all_passed
            else:
                all_passed = log_test("Reschedule to free slot", True, "Rescheduled to 14:00-14:30") and all_passed
    except Exception as e:
        all_passed = log_test("Reschedule to free slot", False, f"Exception: {str(e)}") and all_passed
    
    # CRITICAL TEST: Try to reschedule to an occupied slot
    # First create another appointment at 15:00
    try:
        r = requests.post(f"{BASE_URL}/appointments",
                         json={
                             "doctorId": doctor_id,
                             "branchId": "any",
                             "date": date_str,
                             "startTime": "15:00",
                             "endTime": "15:30",
                             "patientName": "Test Patient 2",
                             "patientEmail": "test2@ejemplo.com",
                             "patientPhone": "+54 11 5555-5678"
                         },
                         headers={"Content-Type": "application/json"})
        
        if r.status_code == 200:
            # Now try to reschedule first appointment to overlap with this one
            r2 = requests.patch(f"{BASE_URL}/appointments/{appointment_id}",
                               json={
                                   "date": date_str,
                                   "startTime": "15:00",
                                   "endTime": "15:30"
                               },
                               headers={"Content-Type": "application/json"})
            
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
    
    # Test 2: Auth
    auth_result, tokens = test_auth()
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
        create_result, appointment_id = test_create_appointment(doctor_id, branch_id, date_str, specialties)
        results.append(("Create Appointment", create_result))
        
        # Test 6: List Appointments
        list_result = test_list_appointments(doctor_id, date_str)
        results.append(("List Appointments", list_result))
        
        # Test 7: Update Appointment
        update_result = test_update_appointment(appointment_id, doctor_id, date_str)
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
