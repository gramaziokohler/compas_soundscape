import os
from specklepy.api.client import SpeckleClient
from dotenv import load_dotenv
from specklepy.api import operations
from specklepy.objects.geometry import Point, Line, Polyline
from specklepy.objects import Base
from specklepy.transports.server import ServerTransport
from specklepy.core.api.inputs.project_inputs import WorkspaceProjectCreateInput
from specklepy.core.api.inputs.model_inputs import CreateModelInput
from specklepy.core.api.inputs.version_inputs import CreateVersionInput
from specklepy.core.api.enums import ProjectVisibility

# 1. Authenticate
load_dotenv()
# Get token from environment
token = os.getenv("SPECKLE_TOKEN")

if not token:
    raise ValueError("SPECKLE_TOKEN environment variable not set")

# Create client
client = SpeckleClient(host="app.speckle.systems")

# Authenticate
client.authenticate_with_token(token)

print(f"✓ Authenticated as {client.account.userInfo.name}")

# Fetch the user's workspaces
workspaces = client.active_user.get_workspaces()

if not workspaces.items:
    raise ValueError("No workspaces found! Please create a workspace on app.speckle.systems first.")

# Use the first available workspace (or filter by name if you prefer)
first_workspace = workspaces.items[0]
print(f"✓ Using workspace: {first_workspace.name} ({first_workspace.id})")

# 2. Create project
# Pass the workspaceId to the ProjectCreateInput
project = client.project.create_in_workspace(WorkspaceProjectCreateInput(
    name="soundscape-viewer",
    description="Learning specklepy",
    visibility="PRIVATE",
    workspaceId=first_workspace.id 
))

print(f"✓ Created project: {project.id}")

# 3. Create geometry
p1 = Point(x=0, y=0, z=0, units="m")
p2 = Point(x=10, y=0, z=0, units="m")
p3 = Point(x=10, y=10, z=0, units="m")
p4 = Point(x=0, y=10, z=0, units="m")

line = Line(start=p1, end=p2, units="m")

# Polyline uses a flat list of coordinates
coords = [
    p1.x, p1.y, p1.z,
    p2.x, p2.y, p2.z,
    p3.x, p3.y, p3.z,
    p4.x, p4.y, p4.z,
    p1.x, p1.y, p1.z,
]
polyline = Polyline(value=coords, units="m")

data = Base()
data.line = line
data.rectangle = polyline
data.points = [p1, p2, p3, p4]
print("✓ Created geometry")

# 4. Send data
# Send to server
transport = ServerTransport(stream_id=project.id, client=client)
object_id = operations.send(base=data, transports=[transport])
print(f"✓ Sent data: {object_id}")

# 5. Create version
# Create a new model
model_input = CreateModelInput(
    project_id=project.id,
    name="My first model",
    description="This is my first model"
)
model = client.model.create(model_input)

version_input = CreateVersionInput(
    project_id=project.id,
    model_id=model.id,
    object_id=object_id,
    message="My first version!"
)
version = client.version.create(version_input)
print(f"✓ Created version: {version.id}")
print(f"View: https://app.speckle.systems/projects/{project.id}/models/{model.id}")

# 6. Receive data
received_data = operations.receive(obj_id=object_id, remote_transport=transport)
print(f"✓ Received data: {len(received_data.points)} points")