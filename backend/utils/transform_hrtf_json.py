"""
Transform HRTF_KEMAR_front.sofa.json to match IRC_1076_C_HRIR_48000.sofa.json structure.

Differences handled:
1. Top-level structure: Add 'attributes' and 'nodes' arrays
2. Type casing: 'float64' -> 'Float64'
3. Remove '_Netcdf4Coordinates' attribute from leaves
4. Create top-level attributes for Data.SamplingRate, Data.Delay, Data.IR, NC_GLOBAL
"""

import json
import os
from datetime import datetime
from pathlib import Path


def capitalize_type(type_str: str) -> str:
    """Convert type string to PascalCase (e.g., 'float64' -> 'Float64')."""
    type_map = {
        "float64": "Float64",
        "float32": "Float32",
        "int32": "Int32",
        "int64": "Int64",
        "uint8": "UInt8",
        "uint16": "UInt16",
        "uint32": "UInt32",
        "uint64": "UInt64",
    }
    return type_map.get(type_str.lower(), type_str)


def filter_attributes(attributes: list) -> list:
    """Remove _Netcdf4Coordinates from attributes list."""
    return [attr for attr in attributes if attr.get("name") != "_Netcdf4Coordinates"]


def extract_leaf_attributes(leaves: list) -> dict:
    """Extract attributes from specific leaves for top-level attributes."""
    leaf_attrs = {}
    for leaf in leaves:
        name = leaf.get("name", "")
        if name in ["Data.SamplingRate", "Data.Delay", "Data.IR"]:
            # Get attributes excluding _Netcdf4Coordinates
            attrs = filter_attributes(leaf.get("attributes", []))
            leaf_attrs[name] = attrs
    return leaf_attrs


def create_nc_global_attributes(source_name: str) -> list:
    """Create NC_GLOBAL attributes for the HRTF file."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    return [
        {"name": "Conventions", "value": ["SOFA"]},
        {"name": "Version", "value": ["1.0"]},
        {"name": "SOFAConventions", "value": ["SimpleFreeFieldHRIR"]},
        {"name": "SOFAConventionsVersion", "value": ["1.0"]},
        {"name": "DataType", "value": ["FIR"]},
        {"name": "RoomType", "value": ["free field"]},
        {"name": "Title", "value": [source_name]},
        {"name": "DateCreated", "value": [now]},
        {"name": "DateModified", "value": [now]},
        {"name": "APIName", "value": ["Python SOFA JSON Converter"]},
        {"name": "APIVersion", "value": ["1.0"]},
        {"name": "AuthorContact", "value": [""]},
        {"name": "Organization", "value": ["KEMAR"]},
        {"name": "License", "value": [""]},
        {"name": "ApplicationName", "value": ["Python"]},
        {"name": "ApplicationVersion", "value": ["3.x"]},
        {"name": "Comment", "value": ["Converted from KEMAR HRTF dataset"]},
        {"name": "History", "value": [""]},
        {"name": "References", "value": [""]},
        {"name": "Origin", "value": [""]},
        {"name": "DatabaseName", "value": ["KEMAR"]},
    ]


def transform_leaf(leaf: dict) -> dict:
    """Transform a single leaf to match the target structure."""
    transformed = {
        "name": leaf.get("name", ""),
        "type": capitalize_type(leaf.get("type", "")),
        "attributes": filter_attributes(leaf.get("attributes", [])),
        "shape": leaf.get("shape", []),
        "data": leaf.get("data", []),
    }
    return transformed


def transform_hrtf_json(source_data: dict) -> dict:
    """Transform source HRTF JSON to match IRC structure."""
    source_name = source_data.get("name", "HRTF")

    # Extract attributes from data leaves for top-level attributes
    leaf_attrs = extract_leaf_attributes(source_data.get("leaves", []))

    # Build top-level attributes array
    top_attributes = [
        {
            "name": "Data.SamplingRate",
            "attributes": leaf_attrs.get("Data.SamplingRate", [{"name": "Units", "value": ["hertz"]}])
        },
        {
            "name": "Data.Delay",
            "attributes": leaf_attrs.get("Data.Delay", [])
        },
        {
            "name": "Data.IR",
            "attributes": leaf_attrs.get("Data.IR", [])
        },
        {
            "name": "NC_GLOBAL",
            "attributes": create_nc_global_attributes(source_name)
        }
    ]

    # Transform all leaves
    transformed_leaves = [transform_leaf(leaf) for leaf in source_data.get("leaves", [])]

    # Build the final structure
    result = {
        "name": source_name,
        "attributes": top_attributes,
        "leaves": transformed_leaves,
        "nodes": []  # IRC has empty nodes array
    }

    return result


def main():
    """Main function to run the transformation."""
    # Define paths
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    hrtf_dir = project_root / "frontend" / "public" / "hrtf"

    source_file = hrtf_dir / "HRTF_KEMAR_front.sofa.json"
    output_file = hrtf_dir / "HRTF_KEMAR_front_transformed.sofa.json"

    print(f"Reading source file: {source_file}")

    # Check if source file exists
    if not source_file.exists():
        print(f"Error: Source file not found: {source_file}")
        return

    # Load source data
    with open(source_file, "r", encoding="utf-8") as f:
        source_data = json.load(f)

    print(f"Source structure:")
    print(f"  - Keys: {list(source_data.keys())}")
    print(f"  - Number of leaves: {len(source_data.get('leaves', []))}")

    # Transform
    print("\nTransforming...")
    transformed_data = transform_hrtf_json(source_data)

    print(f"\nTransformed structure:")
    print(f"  - Keys: {list(transformed_data.keys())}")
    print(f"  - Number of leaves: {len(transformed_data.get('leaves', []))}")
    print(f"  - Number of top-level attributes: {len(transformed_data.get('attributes', []))}")

    # Save transformed data
    print(f"\nSaving to: {output_file}")
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(transformed_data, f, separators=(",", ":"))  # Compact JSON like IRC file

    # Get file size
    size_mb = output_file.stat().st_size / (1024 * 1024)
    print(f"Output file size: {size_mb:.2f} MB")

    print("\nDone! Transformation complete.")


if __name__ == "__main__":
    main()
