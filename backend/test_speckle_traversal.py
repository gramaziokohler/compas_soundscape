"""Test script to debug Speckle object traversal"""
import asyncio
import logging
from services.speckle_service import SpeckleService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def test_traversal():
    """Test the Speckle traversal to see what's in the object tree"""
    
    # Initialize service
    service = SpeckleService()
    
    # Authenticate first
    if not service.authenticate():
        logger.error("Failed to authenticate!")
        return
    
    logger.info("Authentication successful")
    
    project_id = "24066bf854"
    model_id = "d2b34a5407"
    
    logger.info(f"Testing with project: {project_id}, model: {model_id}")
    
    # Get geometry (this will trigger the traversal with debug logs)
    logger.info("\n=== Testing WITHOUT layer filter ===")
    geometry = service.get_model_geometry(
        project_id=project_id,
        version_id_or_object_id=model_id,
        layer_name=None  # No filter to see all objects
    )
    
    if geometry:
        logger.info(f"Result: {len(geometry['vertices'])} vertices, {len(geometry['faces'])} faces")
        logger.info(f"Objects: {len(geometry['object_ids'])}")
    else:
        logger.error("No geometry returned!")
    
    # Now test WITH layer filter for "Acoustics"
    logger.info("\n=== Testing WITH layer filter 'Acoustics' ===")
    geometry_filtered = service.get_model_geometry(
        project_id=project_id,
        version_id_or_object_id=model_id,
        layer_name="Acoustics"
    )
    
    if geometry_filtered:
        logger.info(f"Filtered Result: {len(geometry_filtered['vertices'])} vertices, {len(geometry_filtered['faces'])} faces")
        logger.info(f"Filtered Objects: {len(geometry_filtered['object_ids'])}")
    else:
        logger.error("No filtered geometry returned!")

if __name__ == "__main__":
    asyncio.run(test_traversal())
