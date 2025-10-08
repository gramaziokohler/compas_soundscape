# backend/services/geometry_service.py
# Geometry Processing Service

import os
import shutil
from fastapi import UploadFile, HTTPException
from compas.datastructures import Mesh
from compas.geometry import Sphere
from compas_ifc.model import Model
import rhino3dm

from utils.helpers import rotate_y_up_to_z_up


class GeometryService:
    """Service for processing 3D geometry files"""

    @staticmethod
    def create_sphere_geometry(position: list, radius: float = 0.2):
        """Create a sphere mesh at given position"""
        sphere = Sphere(radius=radius, point=position)
        mesh = Mesh.from_shape(sphere, u=16, v=16)

        vertices = list(mesh.vertices_attributes('xyz'))
        faces = [mesh.face_vertices(fkey) for fkey in mesh.faces()]

        return {"vertices": vertices, "faces": faces}

    @staticmethod
    def process_obj_file(file_path: str):
        """Process OBJ file and return geometry"""
        mesh = Mesh.from_obj(file_path)
        vertices = list(mesh.vertices_attributes('xyz'))
        vertices = [rotate_y_up_to_z_up(v) for v in vertices]
        faces = [mesh.face_vertices(fkey) for fkey in mesh.faces()]
        return {"vertices": vertices, "faces": faces}

    @staticmethod
    def process_stl_file(file_path: str):
        """Process STL file and return geometry"""
        mesh = Mesh.from_stl(file_path)
        vertices = list(mesh.vertices_attributes('xyz'))
        vertices = [rotate_y_up_to_z_up(v) for v in vertices]
        faces = [mesh.face_vertices(fkey) for fkey in mesh.faces()]
        return {"vertices": vertices, "faces": faces}

    @staticmethod
    def process_ifc_file(file_path: str):
        """Process IFC file and return combined geometry"""
        try:
            model = Model(file_path, load_geometries=True)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to load IFC file: {str(e)}")

        all_vertices = []
        all_faces = []
        vertex_offset = 0

        entities = []
        if hasattr(model, 'building_elements'):
            entities = model.building_elements

        if not entities:
            for entity_type in ["IfcWall", "IfcSlab", "IfcColumn", "IfcBeam", "IfcDoor", "IfcWindow", "IfcRoof", "IfcStair"]:
                try:
                    type_entities = model.get_entities_by_type(entity_type)
                    entities.extend(type_entities)
                except:
                    pass

        for i, entity in enumerate(entities):
            try:
                if not hasattr(entity, 'geometry'):
                    continue

                geom = entity.geometry
                if geom is None:
                    continue

                mesh = None
                if isinstance(geom, Mesh):
                    mesh = geom
                elif hasattr(geom, 'to_mesh'):
                    mesh = geom.to_mesh()
                elif hasattr(geom, 'to_vertices_and_faces'):
                    vertices, faces = geom.to_vertices_and_faces()
                    mesh = Mesh.from_vertices_and_faces(vertices, faces)

                if mesh and mesh.number_of_vertices() > 0:
                    vertices = list(mesh.vertices_attributes('xyz'))
                    vertices = [rotate_y_up_to_z_up(v) for v in vertices]
                    all_vertices.extend(vertices)

                    for fkey in mesh.faces():
                        face_vertices = mesh.face_vertices(fkey)
                        adjusted_face = [v + vertex_offset for v in face_vertices]
                        all_faces.append(adjusted_face)

                    vertex_offset += len(vertices)

                    if (i + 1) % 10 == 0:
                        print(f"Processed {i + 1}/{len(entities)} entities")

            except Exception as e:
                print(f"Skipping entity {i}: {e}")
                continue

        if len(all_vertices) == 0:
            raise HTTPException(status_code=400, detail="No geometry found in IFC file.")

        return {"vertices": all_vertices, "faces": all_faces}

    @staticmethod
    def rhino_geom_to_mesh(geom):
        """Convert Rhino geometry to COMPAS mesh"""
        try:
            if isinstance(geom, rhino3dm.Mesh):
                vertices = [[v.X, v.Y, v.Z] for v in geom.Vertices]
                faces = []
                for i in range(geom.Faces.Count):
                    face = geom.Faces[i]
                    if len(face) == 4 and face[2] != face[3]:
                        faces.append([face[0], face[1], face[2], face[3]])
                    else:
                        faces.append([face[0], face[1], face[2]])
                if vertices:
                    return Mesh.from_vertices_and_faces(vertices, faces)

            elif isinstance(geom, rhino3dm.Brep):
                mp = rhino3dm.MeshingParameters.Default
                rhino_mesh = geom.GetMesh(rhino3dm.MeshType.Default, mp)
                if rhino_mesh:
                    vertices = [[v.X, v.Y, v.Z] for v in rhino_mesh.Vertices]
                    faces = []
                    for i in range(rhino_mesh.Faces.Count):
                        face = rhino_mesh.Faces[i]
                        if len(face) == 4 and face[2] != face[3]:
                            faces.append([face[0], face[1], face[2], face[3]])
                        else:
                            faces.append([face[0], face[1], face[2]])
                    if vertices:
                        return Mesh.from_vertices_and_faces(vertices, faces)

            elif isinstance(geom, rhino3dm.Extrusion):
                brep = geom.ToBrep(False)
                if brep:
                    mp = rhino3dm.MeshingParameters.Default
                    rhino_mesh = brep.GetMesh(rhino3dm.MeshType.Default, mp)
                    if rhino_mesh:
                        vertices = [[v.X, v.Y, v.Z] for v in rhino_mesh.Vertices]
                        faces = []
                        for i in range(rhino_mesh.Faces.Count):
                            face = rhino_mesh.Faces[i]
                            if len(face) == 4 and face[2] != face[3]:
                                faces.append([face[0], face[1], face[2], face[3]])
                            else:
                                faces.append([face[0], face[1], face[2]])
                        if vertices:
                            return Mesh.from_vertices_and_faces(vertices, faces)
        except:
            pass

        return None

    @staticmethod
    def process_3dm_file(file_path: str):
        """Process Rhino 3DM file and return geometry"""
        try:
            file3dm = rhino3dm.File3dm.Read(file_path)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to load 3DM file: {str(e)}")

        all_vertices = []
        all_faces = []
        vertex_offset = 0

        for i, obj in enumerate(file3dm.Objects):
            try:
                geom = obj.Geometry
                if geom is None:
                    continue

                if isinstance(geom, rhino3dm.InstanceReference):
                    continue

                mesh = GeometryService.rhino_geom_to_mesh(geom)

                if mesh and mesh.number_of_vertices() > 0:
                    vertices = list(mesh.vertices_attributes('xyz'))
                    vertices = [rotate_y_up_to_z_up(v) for v in vertices]
                    all_vertices.extend(vertices)

                    for fkey in mesh.faces():
                        face_vertices = mesh.face_vertices(fkey)
                        adjusted_face = [v + vertex_offset for v in face_vertices]
                        all_faces.append(adjusted_face)

                    vertex_offset += len(vertices)

                if (i + 1) % 20 == 0:
                    print(f"Processed {i + 1}/{len(file3dm.Objects)} objects")

            except Exception as e:
                if i % 20 == 0:
                    print(f"Skipping object {i}: {e}")
                continue

        if len(all_vertices) == 0:
            raise HTTPException(status_code=400, detail="No geometry found in 3DM file.")

        return {"vertices": all_vertices, "faces": all_faces}
