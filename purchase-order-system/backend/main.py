import os

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, Float, Date
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from pydantic import BaseModel
from datetime import date
from typing import List, Optional

# Database setup
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@db:5432/purchase_orders")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Database model
class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(Integer, primary_key=True, index=True)
    item_name = Column(String, nullable=False)
    order_date = Column(Date, nullable=False)
    delivery_date = Column(Date, nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Float, nullable=False)
    total_price = Column(Float, nullable=False)

# Pydantic models
class PurchaseOrderBase(BaseModel):
    item_name: str
    order_date: date
    delivery_date: date
    quantity: int
    unit_price: float

class PurchaseOrderCreate(PurchaseOrderBase):
    pass

class PurchaseOrderResponse(PurchaseOrderBase):
    id: int
    total_price: float

    class Config:
        from_attributes = True

class PaginatedPurchaseOrderResponse(BaseModel):
    data: List[PurchaseOrderResponse]
    next_cursor: Optional[int] = None
    has_more: bool = False

# V1 Response models (simple pagination)
class SimplePaginatedPurchaseOrderResponse(BaseModel):
    data: List[PurchaseOrderResponse]
    total: int
    page: int
    per_page: int
    total_pages: int

# Create tables
Base.metadata.create_all(bind=engine)

# FastAPI app
app = FastAPI(title="Purchase Order API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# API endpoints
@app.get("/")
def read_root():
    return {"message": "Purchase Order API"}

# =============================================================================
# V1 API Endpoints (Original - Simple pagination for backward compatibility)
# =============================================================================

@app.get("/api/v1/purchase-orders", response_model=SimplePaginatedPurchaseOrderResponse)
def get_purchase_orders_v1(
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(10, ge=1, le=100, description="Items per page"),
    db: Session = Depends(get_db)
):
    # Calculate offset for simple pagination
    offset = (page - 1) * per_page
    
    # Get total count
    total = db.query(PurchaseOrder).count()
    
    # Get paginated data
    orders = db.query(PurchaseOrder).order_by(PurchaseOrder.id).offset(offset).limit(per_page).all()
    
    # Calculate pagination metadata
    total_pages = (total + per_page - 1) // per_page  # Ceiling division
    
    return SimplePaginatedPurchaseOrderResponse(
        data=orders,
        total=total,
        page=page,
        per_page=per_page,
        total_pages=total_pages
    )

@app.get("/api/v1/purchase-orders/{order_id}", response_model=PurchaseOrderResponse)
def get_purchase_order_v1(order_id: int, db: Session = Depends(get_db)):
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return order

@app.post("/api/v1/purchase-orders", response_model=PurchaseOrderResponse, status_code=201)
def create_purchase_order_v1(order: PurchaseOrderCreate, db: Session = Depends(get_db)):
    total_price = order.quantity * order.unit_price
    db_order = PurchaseOrder(
        **order.model_dump(),
        total_price=total_price
    )
    db.add(db_order)
    db.commit()
    db.refresh(db_order)
    return db_order

@app.delete("/api/v1/purchase-orders/{order_id}", status_code=204)
def delete_purchase_order_v1(order_id: int, db: Session = Depends(get_db)):
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    db.delete(order)
    db.commit()
    return None

# =============================================================================
# V2 API Endpoints (Current - Cursor pagination)
# =============================================================================

@app.get("/api/v2/purchase-orders", response_model=PaginatedPurchaseOrderResponse)
def get_purchase_orders_v2(
    cursor: Optional[int] = Query(None, description="Cursor for pagination (last seen ID)"),
    limit: int = Query(10, ge=1, le=100, description="Number of items per page"),
    db: Session = Depends(get_db)
):
    query = db.query(PurchaseOrder).order_by(PurchaseOrder.id)
    
    if cursor is not None:
        query = query.filter(PurchaseOrder.id > cursor)
    
    orders = query.limit(limit + 1).all()
    
    has_more = len(orders) > limit
    if has_more:
        orders = orders[:limit]
    
    next_cursor = orders[-1].id if orders and has_more else None
    
    return PaginatedPurchaseOrderResponse(
        data=orders,
        next_cursor=next_cursor,
        has_more=has_more
    )

@app.get("/api/v2/purchase-orders/{order_id}", response_model=PurchaseOrderResponse)
def get_purchase_order_v2(order_id: int, db: Session = Depends(get_db)):
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return order

@app.post("/api/v2/purchase-orders", response_model=PurchaseOrderResponse, status_code=201)
def create_purchase_order_v2(order: PurchaseOrderCreate, db: Session = Depends(get_db)):
    total_price = order.quantity * order.unit_price
    db_order = PurchaseOrder(
        **order.model_dump(),
        total_price=total_price
    )
    db.add(db_order)
    db.commit()
    db.refresh(db_order)
    return db_order

@app.delete("/api/v2/purchase-orders/{order_id}", status_code=204)
def delete_purchase_order_v2(order_id: int, db: Session = Depends(get_db)):
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    db.delete(order)
    db.commit()
    return None

# =============================================================================
# Legacy endpoints (redirect to v1 for backward compatibility)
# =============================================================================

@app.get("/api/purchase-orders", response_model=SimplePaginatedPurchaseOrderResponse)
def get_purchase_orders_legacy(
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(10, ge=1, le=100, description="Items per page"),
    db: Session = Depends(get_db)
):
    """Legacy endpoint - redirects to v1 for backward compatibility"""
    return get_purchase_orders_v1(page=page, per_page=per_page, db=db)

@app.get("/api/purchase-orders/{order_id}", response_model=PurchaseOrderResponse)
def get_purchase_order_legacy(order_id: int, db: Session = Depends(get_db)):
    """Legacy endpoint - redirects to v1 for backward compatibility"""
    return get_purchase_order_v1(order_id=order_id, db=db)

@app.post("/api/purchase-orders", response_model=PurchaseOrderResponse, status_code=201)
def create_purchase_order_legacy(order: PurchaseOrderCreate, db: Session = Depends(get_db)):
    """Legacy endpoint - redirects to v1 for backward compatibility"""
    return create_purchase_order_v1(order=order, db=db)

@app.delete("/api/purchase-orders/{order_id}", status_code=204)
def delete_purchase_order_legacy(order_id: int, db: Session = Depends(get_db)):
    """Legacy endpoint - redirects to v1 for backward compatibility"""
    return delete_purchase_order_v1(order_id=order_id, db=db)
