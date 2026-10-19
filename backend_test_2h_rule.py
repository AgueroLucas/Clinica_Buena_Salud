#!/usr/bin/env python3
"""
Test script for 2-hour anticipation business rule with Argentina timezone handling.
The server is in UTC but interprets startTime as Argentina local time (UTC-3).
"""

import requests
import os
import sys
from datetime import datetime, timedelta
import json

# Windows console (cp1252) cannot print emojis; force UTF-8 output
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

def _tz(name, offset_hours):
    """ZoneInfo needs the 'tzdata' package on Windows; fall back to a fixed offset."""
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(name)
    except Exception:
        from datetime import timezone
        return timezone(timedelta(hours=offset_hours))

ARG_TZ = _tz("America/Argentina/Buenos_Aires", -3)
UTC_TZ = _tz("UTC", 0)

BASE_URL = os.environ.get("TEST_BASE_URL", "http://localhost:3000/api")
SEED_SECRET = os.environ.get("TEST_SEED_SECRET", "")  # optional: allows POST /seed?force=1

RECEPTION_CREDENTIALS = {"email": "recepcion@clinicabuenasalud.com", "password": "Recepcion@2025!"}

def login(credentials, retries=1):
    """Login helper -> bearer headers dict (empty if it fails). Retries once if rate limited."""
    for attempt in range(retries + 1):
        r = requests.post(f"{BASE_URL}/auth/login", json=credentials, timeout=10)
        if r.status_code == 200 and r.json().get('token'):
            return {"Authorization": f"Bearer {r.json()['token']}"}
        if r.status_code == 429 and attempt < retries:
            print("  (rate limited, waiting 61s before retrying login...)")
            import time; time.sleep(61)
            continue
        print(f"⚠️  Login failed for {credentials['email']}: {r.status_code} {r.text[:120]}")
        return {}
    return {}

def print_section(title):
    print(f"\n{'='*80}")
    print(f"  {title}")
    print(f"{'='*80}\n")

def test_2h_anticipation_rule():
    """Test the 2-hour anticipation rule with proper Argentina timezone handling."""
    
    print_section("STEP 1: Clean seed")
    try:
        # force=1 (wipe + reseed) requires admin session or X-Seed-Secret header
        headers = {"X-Seed-Secret": SEED_SECRET} if SEED_SECRET else {}
        url = f"{BASE_URL}/seed?force=1" if SEED_SECRET else f"{BASE_URL}/seed"
        resp = requests.post(url, headers=headers, timeout=30)
        print(f"Seed response: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            print(f"✅ Seed successful: {json.dumps(data, indent=2)}")
        elif resp.status_code == 403:
            print("❌ Seed failed: 403 (set TEST_SEED_SECRET env to force a reseed)")
            return
        else:
            print(f"❌ Seed failed: {resp.text}")
            return
    except Exception as e:
        print(f"❌ Seed error: {e}")
        return

    print_section("STEP 1B: Login as reception (required for booking)")
    headers = login(RECEPTION_CREDENTIALS)
    if not headers:
        print("❌ Could not authenticate - appointment endpoints require a session")
        return
    print("✅ Authenticated as reception")

    print_section("STEP 2: Get doctor data")
    try:
        resp = requests.get(f"{BASE_URL}/doctors", timeout=10)
        if resp.status_code != 200:
            print(f"❌ Failed to get doctors: {resp.status_code} - {resp.text}")
            return
        
        doctors = resp.json().get('doctors', [])
        if not doctors:
            print("❌ No doctors found")
            return
        
        doctor = doctors[0]
        doctor_id = doctor['id']
        branch_id = doctor['branchIds'][0] if doctor.get('branchIds') else None
        specialty_id = doctor['specialtyIds'][0] if doctor.get('specialtyIds') else None
        
        print(f"✅ Using doctor: {doctor.get('firstName')} {doctor.get('lastName')}")
        print(f"   Doctor ID: {doctor_id}")
        print(f"   Branch ID: {branch_id}")
        print(f"   Specialty ID: {specialty_id}")
        
        if not branch_id or not specialty_id:
            print("❌ Doctor missing branchIds or specialtyIds")
            return
            
    except Exception as e:
        print(f"❌ Error getting doctors: {e}")
        return

    # Argentina timezone
    arg_tz = ARG_TZ
    now_arg = datetime.now(arg_tz)
    
    print_section("STEP 3: Test Cases")
    print(f"Current Argentina time: {now_arg.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    print(f"Current UTC time: {datetime.now(UTC_TZ).strftime('%Y-%m-%d %H:%M:%S %Z')}")
    
    # Test results table
    results = []
    
    # ========== CASE 0: No session (must be REJECTED with 401) ==========
    print("\n" + "-"*80)
    print("CASE 0: Booking without session (must REJECT with 401)")
    print("-"*80)
    try:
        resp = requests.post(f"{BASE_URL}/appointments", json={
            "doctorId": doctor_id, "branchId": branch_id,
            "date": (now_arg + timedelta(days=3)).strftime("%Y-%m-%d"),
            "startTime": "10:00", "endTime": "10:30",
        }, timeout=10)
        if resp.status_code == 401:
            print("✅ CASE 0 PASSED: Unauthenticated booking rejected with 401")
            results.append(("Case 0 (no session)", "✅ PASS", "401"))
        else:
            print(f"❌ CASE 0 FAILED: Expected 401, got {resp.status_code}")
            results.append(("Case 0 (no session)", "❌ FAIL", f"Got {resp.status_code}"))
    except Exception as e:
        print(f"❌ CASE 0 ERROR: {e}")
        results.append(("Case 0 (no session)", "❌ ERROR", str(e)))
    
    # ========== CASE A: 1 hour ahead (should REJECT with 400) ==========
    print("\n" + "-"*80)
    print("CASE A: 1 hour ahead in Argentina time (should REJECT with 400)")
    print("-"*80)
    
    t1 = now_arg + timedelta(hours=1)
    t1_end = t1 + timedelta(minutes=30)
    
    payload_a = {
        "doctorId": doctor_id,
        "branchId": branch_id,
        "specialtyId": specialty_id,
        "patientName": "Test User A",
        "patientEmail": "test-2h-a@ejemplo.com",
        "patientPhone": "+54 11 5555-1111",
        "date": t1.strftime("%Y-%m-%d"),
        "startTime": t1.strftime("%H:%M"),
        "endTime": t1_end.strftime("%H:%M"),
        "notes": "Test 1h anticipation"
    }
    
    print(f"Payload: date={payload_a['date']}, startTime={payload_a['startTime']}, endTime={payload_a['endTime']}")
    print(f"Argentina time: {t1.strftime('%Y-%m-%d %H:%M')} (1h from now)")
    
    try:
        resp = requests.post(f"{BASE_URL}/appointments", json=payload_a, headers=headers, timeout=10)
        print(f"Response status: {resp.status_code}")
        print(f"Response body: {resp.text}")
        
        if resp.status_code == 400 and "2 horas de anticipación" in resp.text:
            print("✅ CASE A PASSED: Correctly rejected 1h appointment with 400")
            results.append(("Case A (1h ahead)", "✅ PASS", "400 with '2 horas de anticipación'"))
        elif resp.status_code == 400:
            print("⚠️  CASE A PARTIAL: Rejected with 400 but wrong message")
            results.append(("Case A (1h ahead)", "⚠️  PARTIAL", f"400 but message: {resp.text}"))
        else:
            print(f"❌ CASE A FAILED: Should reject with 400, got {resp.status_code}")
            results.append(("Case A (1h ahead)", "❌ FAIL", f"Got {resp.status_code}, expected 400"))
    except Exception as e:
        print(f"❌ CASE A ERROR: {e}")
        results.append(("Case A (1h ahead)", "❌ ERROR", str(e)))

    # ========== CASE B: 3 hours ahead, aligned to 30-min slot (should ACCEPT with 200) ==========
    print("\n" + "-"*80)
    print("CASE B: 3 hours ahead in Argentina time, aligned to 30-min slot (should ACCEPT with 200)")
    print("-"*80)
    
    t3 = now_arg + timedelta(hours=3)
    # Align to 30-min slot
    minute = 0 if t3.minute < 30 else 30
    t3 = t3.replace(minute=minute, second=0, microsecond=0)
    t3_end = t3 + timedelta(minutes=30)
    
    payload_b = {
        "doctorId": doctor_id,
        "branchId": branch_id,
        "specialtyId": specialty_id,
        "patientName": "Test User B",
        "patientEmail": "test-2h-b@ejemplo.com",
        "patientPhone": "+54 11 5555-2222",
        "date": t3.strftime("%Y-%m-%d"),
        "startTime": t3.strftime("%H:%M"),
        "endTime": t3_end.strftime("%H:%M"),
        "notes": "Test 3h anticipation"
    }
    
    print(f"Payload: date={payload_b['date']}, startTime={payload_b['startTime']}, endTime={payload_b['endTime']}")
    print(f"Argentina time: {t3.strftime('%Y-%m-%d %H:%M')} (3h from now, aligned)")
    
    appointment_id_b = None
    try:
        resp = requests.post(f"{BASE_URL}/appointments", json=payload_b, headers=headers, timeout=10)
        print(f"Response status: {resp.status_code}")
        print(f"Response body: {resp.text[:500]}")
        
        if resp.status_code == 200:
            data = resp.json()
            appointment_id_b = data.get('appointment', {}).get('id')
            print(f"✅ CASE B PASSED: Correctly accepted 3h appointment with 200")
            print(f"   Appointment ID: {appointment_id_b}")
            results.append(("Case B (3h ahead)", "✅ PASS", f"200, created appointment {appointment_id_b}"))
        else:
            print(f"❌ CASE B FAILED: Should accept with 200, got {resp.status_code}")
            results.append(("Case B (3h ahead)", "❌ FAIL", f"Got {resp.status_code}, expected 200"))
    except Exception as e:
        print(f"❌ CASE B ERROR: {e}")
        results.append(("Case B (3h ahead)", "❌ ERROR", str(e)))

    # ========== CASE C: Past date (should REJECT with 400) ==========
    print("\n" + "-"*80)
    print("CASE C: Past date (yesterday) (should REJECT with 400)")
    print("-"*80)
    
    yesterday = now_arg - timedelta(days=1)
    t_past = yesterday.replace(hour=10, minute=0, second=0, microsecond=0)
    t_past_end = t_past + timedelta(minutes=30)
    
    payload_c = {
        "doctorId": doctor_id,
        "branchId": branch_id,
        "specialtyId": specialty_id,
        "patientName": "Test User C",
        "patientEmail": "test-2h-c@ejemplo.com",
        "patientPhone": "+54 11 5555-3333",
        "date": t_past.strftime("%Y-%m-%d"),
        "startTime": t_past.strftime("%H:%M"),
        "endTime": t_past_end.strftime("%H:%M"),
        "notes": "Test past date"
    }
    
    print(f"Payload: date={payload_c['date']}, startTime={payload_c['startTime']}, endTime={payload_c['endTime']}")
    print(f"Argentina time: {t_past.strftime('%Y-%m-%d %H:%M')} (yesterday)")
    
    try:
        resp = requests.post(f"{BASE_URL}/appointments", json=payload_c, headers=headers, timeout=10)
        print(f"Response status: {resp.status_code}")
        print(f"Response body: {resp.text}")
        
        if resp.status_code == 400:
            print("✅ CASE C PASSED: Correctly rejected past date with 400")
            results.append(("Case C (past date)", "✅ PASS", "400"))
        else:
            print(f"❌ CASE C FAILED: Should reject with 400, got {resp.status_code}")
            results.append(("Case C (past date)", "❌ FAIL", f"Got {resp.status_code}, expected 400"))
    except Exception as e:
        print(f"❌ CASE C ERROR: {e}")
        results.append(("Case C (past date)", "❌ ERROR", str(e)))

    # ========== CASE D: Late cancellation (create 12h ahead, then cancel) ==========
    print("\n" + "-"*80)
    print("CASE D: Late cancellation (create 12h ahead, then cancel and verify lateCancellation flag)")
    print("-"*80)
    
    t12 = now_arg + timedelta(hours=12)
    # Align to 30-min slot
    minute = 0 if t12.minute < 30 else 30
    t12 = t12.replace(minute=minute, second=0, microsecond=0)
    t12_end = t12 + timedelta(minutes=30)
    
    payload_d = {
        "doctorId": doctor_id,
        "branchId": branch_id,
        "specialtyId": specialty_id,
        "patientName": "Test User D",
        "patientEmail": "test-2h-d@ejemplo.com",
        "patientPhone": "+54 11 5555-4444",
        "date": t12.strftime("%Y-%m-%d"),
        "startTime": t12.strftime("%H:%M"),
        "endTime": t12_end.strftime("%H:%M"),
        "notes": "Test late cancellation"
    }
    
    print(f"Payload: date={payload_d['date']}, startTime={payload_d['startTime']}, endTime={payload_d['endTime']}")
    print(f"Argentina time: {t12.strftime('%Y-%m-%d %H:%M')} (12h from now, aligned)")
    
    appointment_id_d = None
    try:
        # Create appointment
        resp = requests.post(f"{BASE_URL}/appointments", json=payload_d, headers=headers, timeout=10)
        print(f"Create response status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            appointment_id_d = data.get('appointment', {}).get('id')
            print(f"✅ Created appointment: {appointment_id_d}")
            
            # Cancel it
            cancel_payload = {"status": "cancelled", "cancelReason": "Test late cancellation"}
            resp_cancel = requests.patch(f"{BASE_URL}/appointments/{appointment_id_d}", json=cancel_payload, headers=headers, timeout=10)
            print(f"Cancel response status: {resp_cancel.status_code}")
            
            if resp_cancel.status_code == 200:
                cancel_data = resp_cancel.json()
                late_cancel = cancel_data.get('appointment', {}).get('lateCancellation')
                print(f"lateCancellation flag: {late_cancel}")
                
                if late_cancel is True:
                    print("✅ CASE D PASSED: lateCancellation flag set to true")
                    results.append(("Case D (late cancel)", "✅ PASS", "lateCancellation=true"))
                else:
                    print(f"❌ CASE D FAILED: lateCancellation should be true, got {late_cancel}")
                    results.append(("Case D (late cancel)", "❌ FAIL", f"lateCancellation={late_cancel}"))
                    
                # Verify in MongoDB
                print("\nVerifying in MongoDB...")
                import subprocess
                mongo_cmd = f'mongosh --quiet --eval "use clinica_buena_salud; db.appointments.findOne({{id: \\"{appointment_id_d}\\"}})"'
                try:
                    result = subprocess.run(mongo_cmd, shell=True, capture_output=True, text=True, timeout=10)
                    print(f"MongoDB query result:\n{result.stdout}")
                except Exception as e:
                    print(f"⚠️  Could not verify in MongoDB: {e}")
            else:
                print(f"❌ CASE D FAILED: Cancel failed with {resp_cancel.status_code}")
                results.append(("Case D (late cancel)", "❌ FAIL", f"Cancel failed: {resp_cancel.status_code}"))
        else:
            print(f"❌ CASE D FAILED: Could not create appointment, got {resp.status_code}")
            results.append(("Case D (late cancel)", "❌ FAIL", f"Create failed: {resp.status_code}"))
    except Exception as e:
        print(f"❌ CASE D ERROR: {e}")
        results.append(("Case D (late cancel)", "❌ ERROR", str(e)))

    # ========== SUMMARY TABLE ==========
    print_section("TEST RESULTS SUMMARY")
    print(f"{'Test Case':<30} {'Result':<15} {'Details':<50}")
    print("-" * 95)
    for test_name, result, details in results:
        print(f"{test_name:<30} {result:<15} {details:<50}")
    
    # Count results
    passed = sum(1 for _, r, _ in results if "✅" in r)
    failed = sum(1 for _, r, _ in results if "❌" in r)
    partial = sum(1 for _, r, _ in results if "⚠️" in r)
    
    print("\n" + "="*95)
    print(f"TOTAL: {passed} passed, {failed} failed, {partial} partial out of {len(results)} tests")
    print("="*95)
    
    return passed == len(results)

if __name__ == "__main__":
    try:
        success = test_2h_anticipation_rule()
        exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
