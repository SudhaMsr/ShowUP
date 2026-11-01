"""Builds a synthetic, messy events workbook for tests (no personal data)."""
import sys
from openpyxl import Workbook
wb = Workbook()
ws = wb.active
ws.title = "Master Tracker"
ws.append([])
ws.append(["Date", "Time", "Type", "Title", "Location", "Company/Event", "Status", "Notes"])
ws.append([46133, "14:30", "Meeting", "Mentor Meeting", "Cafe One", None, "Done"])
ws.append([46134, 0.75, "Meetup", "AI Meetup", "Origin Workspace", None, "Done"])
ws.append([46140, "2.30", "interview", "Team Sport", "Way", None, None])
ws.append([46141, "10.3", "Meetup", "Peer Support", "Engineers House", None, "Pending"])
ws.append([46150, "NA", "Submission", "Work pack"])
ws.append(["08 to 12th", None, "AI Fest", "Online Fest", "Online"])
ws.append([None, None, "Meeting", "No date row"])
ws.append([46198, "12pm", "Session", "Connections", "Sciences", None, "Cancelled"])
ws.append([46134, "14:30", "Meeting", "Mentor Meeting", "Cafe One"])  # different day, same title
ws.append([46133, "14:30", "Meeting", "Mentor Meeting", "Cafe One"])  # duplicate
ws.append([None, None, None, "INTERVIEWS"])
ws2 = wb.create_sheet("Notes")
ws2.append(["Grant", "Status"])
ws2.append(["Some grant", "Open"])
wb.save(sys.argv[1])
