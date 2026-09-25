import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCHEMA = os.path.join(ROOT, "apps", "server", "prisma", "schema.prisma")

with open(SCHEMA) as f:
    schema = f.read()

# The key fixes:
# 1. inviteCodes relation: invite_code[] → InviteCode[] (model name, capitalized)
# 2. Ensure all model references use the model name (capital), not table name

# Fix the inviteCodes relation line
schema = schema.replace(
    "  inviteCodes  invite_code[] @relation(\"InviteOf\")",
    "  inviteCodes  InviteCode[] @relation(\"InviteOf\")"
)

# Check for any other lowercase relation references that should be model names
# The models defined: User, Avatar, InviteCode, Room, Message, Friend, Inventory, RoomFurniture, SavedFurniture, FontChoice, FontStyle, FurnitureTemplate

# Write corrected schema back to local file
with open(SCHEMA, "w") as f:
    f.write(schema)

print("Fixed. Checking for lowercase model references...")
# Find any lines that have @relation or [] with lowercase names that might be models
for i, line in enumerate(schema.split('\n'), 1):
    if re.search(r'\b([a-z][a-z_]+)\[\]', line) and ('model' not in line.lower() or '@relation' in line or '@map' in line):
        # Check if this lowercase name matches a model name (case-insensitive)
        models = ['User', 'Avatar', 'InviteCode', 'Room', 'Message', 'Friend', 'Inventory', 'RoomFurniture', 'SavedFurniture', 'FontChoice', 'FontStyle', 'FurnitureTemplate']
        for m in models:
            if m.lower() in line.lower() and m not in line:
                print(f"Line {i}: potential issue - '{m}' model referenced lowercase?")
                print(f"  {line.strip()}")

print("\nDone.")
