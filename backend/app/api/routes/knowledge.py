from fastapi import APIRouter, Depends
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.knowledge import KnowledgeEntry
from app.schemas.knowledge import KnowledgeEntryRead, KnowledgeSearchRequest
from app.services.knowledge_base import KnowledgeBaseService


router = APIRouter(prefix="/knowledge", tags=["knowledge"])


@router.post("/search", response_model=list[KnowledgeEntryRead])
def search_knowledge(payload: KnowledgeSearchRequest, db: Session = Depends(get_db)) -> list[KnowledgeEntry]:
    service = KnowledgeBaseService(db)
    return service.retrieve_similar_cases(
        stage_key=payload.stage_key,
        calculation_type=payload.calculation_type,
        material_system=payload.material_system,
        task_goal=payload.task_goal,
        top_k=payload.top_k,
    )


@router.get("", response_model=list[KnowledgeEntryRead])
def list_knowledge_entries(db: Session = Depends(get_db)) -> list[KnowledgeEntry]:
    stmt = select(KnowledgeEntry).order_by(desc(KnowledgeEntry.created_at)).limit(50)
    return list(db.scalars(stmt).all())

