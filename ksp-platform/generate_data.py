"""
Synthetic FIR dataset generator — modeled on the Karnataka Police FIR ER schema.
Generates data.json consumed directly by the static frontend (no backend needed).

Design choices (deliberate, for the hackathon narrative):
- CasteID / ReligionID exist in the real schema but are NOT generated or used here.
  This is a stated design decision (see bias-audit panel in the UI), not an oversight.
- Crime series are injected on purpose (near-repeat clusters: same sub-head, same
  station catchment, tight time window) so the prediction view has something real
  to detect — this mirrors how near-repeat victimization actually looks in FIR data.
- A small set of "repeat" accused persons are deliberately inserted across DIFFERENT
  police stations under different FIRs, to demonstrate the data-silo problem: the
  same person, unlinked, sitting in separate station records.
"""
import json, random, math, hashlib
from datetime import datetime, timedelta

random.seed(42)

# ---------- Reference data (mirrors State/District/Unit/CrimeHead/CrimeSubHead/Act/Section) ----------

STATE = {"id": 1, "name": "Karnataka"}

DISTRICTS = [
    {"id": 1, "name": "Bengaluru City", "lat": 12.9716, "lng": 77.5946},
    {"id": 2, "name": "Mysuru", "lat": 12.2958, "lng": 76.6394},
    {"id": 3, "name": "Belagavi", "lat": 15.8497, "lng": 74.4977},
    {"id": 4, "name": "Kalaburagi", "lat": 17.3297, "lng": 76.8343},
    {"id": 5, "name": "Dakshina Kannada", "lat": 12.9141, "lng": 74.8560},
    {"id": 6, "name": "Tumakuru", "lat": 13.3379, "lng": 77.1173},
]

UNIT_NAMES = ["Town PS", "City Market PS", "Industrial Area PS", "Rural PS", "Traffic PS", "Women PS", "Cyber Crime PS"]

UNITS = []
uid = 1
for d in DISTRICTS:
    n_units = random.randint(4, 6)
    for i in range(n_units):
        # jitter around district centroid to place stations
        lat = d["lat"] + random.uniform(-0.12, 0.12)
        lng = d["lng"] + random.uniform(-0.12, 0.12)
        UNITS.append({
            "id": uid,
            "name": f"{d['name'].split()[0]} {UNIT_NAMES[i % len(UNIT_NAMES)]} {i+1}",
            "districtId": d["id"],
            "lat": round(lat, 5),
            "lng": round(lng, 5),
        })
        uid += 1

CRIME_HEADS = [
    {"id": 1, "name": "Crimes Against Property"},
    {"id": 2, "name": "Crimes Against Body"},
    {"id": 3, "name": "Crimes Against Women"},
    {"id": 4, "name": "Cyber Crime"},
    {"id": 5, "name": "NDPS (Narcotics)"},
    {"id": 6, "name": "Public Order"},
]

CRIME_SUBHEADS = [
    {"id": 1, "headId": 1, "name": "Theft"},
    {"id": 2, "headId": 1, "name": "Burglary / House-breaking"},
    {"id": 3, "headId": 1, "name": "Chain Snatching"},
    {"id": 4, "headId": 1, "name": "Vehicle Theft"},
    {"id": 5, "headId": 1, "name": "Robbery"},
    {"id": 6, "headId": 2, "name": "Grievous Hurt"},
    {"id": 7, "headId": 2, "name": "Murder"},
    {"id": 8, "headId": 2, "name": "Assault"},
    {"id": 9, "headId": 3, "name": "Molestation"},
    {"id": 10, "headId": 3, "name": "Domestic Violence Complaint"},
    {"id": 11, "headId": 4, "name": "Online Financial Fraud"},
    {"id": 12, "headId": 4, "name": "Social Media Harassment"},
    {"id": 13, "headId": 5, "name": "Possession"},
    {"id": 14, "headId": 5, "name": "Peddling"},
    {"id": 15, "headId": 6, "name": "Rioting"},
    {"id": 16, "headId": 6, "name": "Public Nuisance"},
]

ACT_SECTIONS = {
    1: [("BNS", "303"), ("BNS", "305")],
    2: [("BNS", "331"), ("BNS", "305")],
    3: [("BNS", "304"), ("BNS", "309")],
    4: [("BNS", "304"), ("BNS", "308")],
    5: [("BNS", "309")],
    6: [("BNS", "117")],
    7: [("BNS", "103")],
    8: [("BNS", "115")],
    9: [("BNS", "74")],
    10: [("BNS", "85"), ("DV Act", "12")],
    11: [("IT Act", "66D"), ("BNS", "318")],
    12: [("IT Act", "67")],
    13: [("NDPS Act", "20")],
    14: [("NDPS Act", "20"), ("NDPS Act", "27A")],
    15: [("BNS", "191")],
    16: [("BNS", "268")],
}

CASE_CATEGORIES = ["FIR", "UDR", "PAR", "Zero FIR"]
GRAVITY = ["Heinous", "Non-Heinous"]
CASE_STATUS = ["Under Investigation", "Charge Sheeted", "Closed", "Undetected"]

FIRST_NAMES_M = ["Raju", "Manjunath", "Suresh", "Naveen", "Praveen", "Ravi", "Kiran", "Ganesh", "Prasad", "Vinay",
                 "Anil", "Santosh", "Basavaraj", "Shivakumar", "Mahesh", "Ramesh", "Nagaraj", "Srinivas"]
FIRST_NAMES_F = ["Lakshmi", "Sushma", "Kavya", "Anitha", "Shobha", "Deepa", "Pooja", "Radha", "Savitri", "Manjula",
                 "Bhavani", "Geetha", "Nandini", "Chaitra", "Sowmya"]
LAST_NAMES = ["Gowda", "Naik", "Reddy", "Shetty", "Rao", "Patil", "Kumar", "Hegde", "Achar", "Poojary", ""]

def rand_name(gender):
    fn = random.choice(FIRST_NAMES_M if gender == "M" else FIRST_NAMES_F)
    ln = random.choice(LAST_NAMES)
    return f"{fn} {ln}".strip()

def crime_no(cat_idx, district_id, unit_id, year, serial):
    cat_code = str(cat_idx + 1)
    return f"{cat_code}{district_id:04d}{unit_id:04d}{year}{serial:05d}"

START_DATE = datetime(2025, 8, 1)
END_DATE = datetime(2026, 7, 15)
TOTAL_DAYS = (END_DATE - START_DATE).days

# ---------- Repeat-offender pool (the "data silo" story) ----------
# These identities intentionally reappear across DIFFERENT units/districts.
REPEAT_OFFENDERS = []
for i in range(14):
    gender = random.choice(["M", "M", "M", "F"])
    REPEAT_OFFENDERS.append({
        "name": rand_name(gender),
        "age": random.randint(19, 42),
        "gender": gender,
        "preferred_subheads": random.sample([1, 2, 3, 4, 5], k=random.choice([1, 2])),
    })

def offender_key(name, age, gender):
    # crude entity-resolution key: name + age bucket + gender
    return hashlib.md5(f"{name.strip().lower()}|{age//3}|{gender}".encode()).hexdigest()[:10]

# ---------- Case generation ----------
cases = []
case_id = 1
serial_counters = {}  # (unitId, cat) -> serial per year

def next_serial(unit_id, cat_idx, year):
    key = (unit_id, cat_idx, year)
    serial_counters[key] = serial_counters.get(key, 0) + 1
    return serial_counters[key]

def make_case(dt, unit, subhead, forced_offender=None, note=""):
    global case_id
    head = next(h for h in CRIME_HEADS if h["id"] == subhead["headId"])
    cat_idx = 0 if random.random() > 0.05 else random.choice([1, 2, 3])
    year = dt.year
    serial = next_serial(unit["id"], cat_idx, year)
    cno = crime_no(cat_idx, unit["districtId"], unit["id"], year, serial)
    lat = unit["lat"] + random.uniform(-0.02, 0.02)
    lng = unit["lng"] + random.uniform(-0.02, 0.02)

    n_accused = 1 if random.random() > 0.3 else random.randint(2, 3)
    accused_list = []
    for i in range(n_accused):
        if forced_offender and i == 0:
            g = forced_offender["gender"]
            nm = forced_offender["name"]
            age = forced_offender["age"]
        else:
            g = random.choice(["M", "M", "M", "F"])
            nm = rand_name(g)
            age = random.randint(18, 55)
        accused_list.append({
            "id": f"{case_id}-A{i+1}",
            "name": nm, "age": age, "gender": g,
            "personId": f"A{i+1}",
            "entityKey": offender_key(nm, age, g),
        })

    n_victims = random.randint(1, 2)
    victims = [{
        "id": f"{case_id}-V{i+1}",
        "name": rand_name(random.choice(["M", "F"])),
        "age": random.randint(8, 70),
        "gender": random.choice(["M", "F"]),
    } for i in range(n_victims)]

    complainants = [{
        "id": f"{case_id}-C1",
        "name": victims[0]["name"] if random.random() > 0.4 else rand_name(random.choice(["M", "F"])),
        "age": random.randint(20, 65),
        "occupation": random.choice(["Private Employee", "Business", "Farmer", "Student", "Homemaker", "Government Employee", "Unemployed"]),
    }]

    sections = [{"act": a, "section": s} for a, s in ACT_SECTIONS.get(subhead["id"], [("BNS", "318")])]

    arrests = []
    if random.random() > 0.55:
        for a in accused_list:
            if random.random() > 0.4:
                arrests.append({
                    "accusedEntityKey": a["entityKey"],
                    "date": (dt + timedelta(days=random.randint(0, 20))).strftime("%Y-%m-%d"),
                })

    status = random.choices(CASE_STATUS, weights=[0.35, 0.30, 0.20, 0.15])[0]

    cases.append({
        "id": case_id,
        "crimeNo": cno,
        "caseCategory": CASE_CATEGORIES[cat_idx],
        "registeredDate": dt.strftime("%Y-%m-%d"),
        "unitId": unit["id"],
        "districtId": unit["districtId"],
        "crimeHeadId": head["id"],
        "crimeSubHeadId": subhead["id"],
        "gravity": "Heinous" if head["id"] in (2, 3, 5) and random.random() > 0.5 else "Non-Heinous",
        "status": status,
        "lat": round(lat, 5),
        "lng": round(lng, 5),
        "briefFacts": note or f"{subhead['name']} reported in the jurisdiction.",
        "accused": accused_list,
        "victims": victims,
        "complainants": complainants,
        "sections": sections,
        "arrests": arrests,
    })
    case_id += 1

# 1) Background / baseline caseload — spread across the year
for _ in range(1400):
    unit = random.choice(UNITS)
    subhead = random.choice(CRIME_SUBHEADS)
    day_offset = random.randint(0, TOTAL_DAYS)
    dt = START_DATE + timedelta(days=day_offset)
    make_case(dt, unit, subhead)

# 2) Injected near-repeat crime series — tight clusters in space+time, same sub-head
#    This is what the prediction view should be able to detect.
property_subheads = [s for s in CRIME_SUBHEADS if s["headId"] == 1]
for series_i in range(10):
    unit = random.choice(UNITS)
    subhead = random.choice(property_subheads)
    series_start = START_DATE + timedelta(days=random.randint(30, TOTAL_DAYS - 40))
    n_events = random.randint(4, 7)
    for e in range(n_events):
        dt = series_start + timedelta(days=random.randint(0, 3) + e * random.randint(2, 5))
        if dt > END_DATE:
            break
        make_case(dt, unit, subhead, note=f"Part of a recurring {subhead['name'].lower()} pattern in this catchment.")

# 3) Repeat offenders reappearing under DIFFERENT stations/districts (data-silo story)
for offender in REPEAT_OFFENDERS:
    n_appearances = random.randint(3, 5)
    chosen_units = random.sample(UNITS, k=min(n_appearances, len(UNITS)))
    for unit in chosen_units:
        subhead_id = random.choice(offender["preferred_subheads"])
        subhead = next(s for s in CRIME_SUBHEADS if s["id"] == subhead_id)
        day_offset = random.randint(0, TOTAL_DAYS)
        dt = START_DATE + timedelta(days=day_offset)
        make_case(dt, unit, subhead, forced_offender=offender,
                  note=f"{subhead['name']} — accused matches pattern seen in other station records.")

cases.sort(key=lambda c: c["registeredDate"])
for i, c in enumerate(cases):
    c["id"] = i + 1

output = {
    "generatedAt": datetime.now().isoformat(),
    "state": STATE,
    "districts": DISTRICTS,
    "units": UNITS,
    "crimeHeads": CRIME_HEADS,
    "crimeSubHeads": CRIME_SUBHEADS,
    "cases": cases,
    "excludedFields": ["CasteID", "ReligionID"],
}

with open("data/data.json", "w") as f:
    json.dump(output, f)

print(f"Generated {len(cases)} cases across {len(UNITS)} units in {len(DISTRICTS)} districts.")
print(f"Repeat-offender identities injected: {len(REPEAT_OFFENDERS)}")
