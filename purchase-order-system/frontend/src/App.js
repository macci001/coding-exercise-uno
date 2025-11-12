import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// Constants for performance
const PAGE_SIZE = 20; // Number of items to fetch per page
const CACHE_SIZE = 1000; // Maximum number of items to keep in cache

// Swipe constants
const SWIPE_THRESHOLD = 0.5; // 50% of card width
const ANIMATION_DURATION = 300; // milliseconds

function App() {
  // State management
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [hasNextPage, setHasNextPage] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [toast, setToast] = useState(null);
  const [deletingItems, setDeletingItems] = useState(new Set());
  const [formData, setFormData] = useState({
    item_name: '',
    order_date: '',
    delivery_date: '',
    quantity: '',
    unit_price: ''
  });

  // Refs
  const cacheRef = useRef(new Map());
  const prefetchingRef = useRef(new Set());
  const containerRef = useRef(null);
  const scrollTimeoutRef = useRef(null);

  // Memoized cache management
  const cache = useMemo(() => ({
    set: (key, value) => {
      if (cacheRef.current.size >= CACHE_SIZE) {
        const firstKey = cacheRef.current.keys().next().value;
        cacheRef.current.delete(firstKey);
      }
      cacheRef.current.set(key, value);
    },
    get: (key) => cacheRef.current.get(key),
    has: (key) => cacheRef.current.has(key),
    clear: () => cacheRef.current.clear()
  }), []);

  // Toast notification
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Fetch orders with caching
  const fetchOrders = useCallback(async (cursor = null, shouldReset = false) => {
    try {
      const cacheKey = `orders_${cursor || 'initial'}`;
      
      // Check cache first
      if (cache.has(cacheKey) && !shouldReset) {
        const cachedData = cache.get(cacheKey);
        if (!shouldReset && !cursor) {
          setItems(cachedData.data);
          setNextCursor(cachedData.next_cursor);
          setHasNextPage(cachedData.has_more);
        }
        return cachedData;
      }

      // Prevent duplicate requests
      if (prefetchingRef.current.has(cacheKey)) {
        return null;
      }

      prefetchingRef.current.add(cacheKey);

      if (shouldReset || cursor === null) {
        setLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      const params = new URLSearchParams();
      if (cursor) params.append('cursor', cursor);
      params.append('limit', PAGE_SIZE.toString());

      const response = await axios.get(`${API_URL}/api/purchase-orders?${params}`);
      const { data, next_cursor, has_more } = response.data;

      // Cache the response
      cache.set(cacheKey, { data, next_cursor, has_more });

      if (shouldReset || cursor === null) {
        setItems(data);
      } else {
        setItems(prev => [...prev, ...data]);
      }

      setNextCursor(next_cursor);
      setHasNextPage(has_more);
      setError(null);

      return { data, next_cursor, has_more };
    } catch (err) {
      setError('Failed to fetch purchase orders');
      console.error(err);
      return null;
    } finally {
      setLoading(false);
      setIsLoadingMore(false);
      const cacheKey = `orders_${cursor || 'initial'}`;
      prefetchingRef.current.delete(cacheKey);
    }
  }, [cache]);

  // Handle scroll events with throttling
  const handleScroll = useCallback((e) => {
    // Clear existing timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    // Throttle scroll handling
    scrollTimeoutRef.current = setTimeout(() => {
      const container = e.target;
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;
      
      // Adaptive infinite scroll trigger based on screen size
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
      const triggerDistance = Math.max(400, clientHeight * 0.5); // 50% of viewport height or 400px minimum
      
      if (distanceFromBottom < triggerDistance && hasNextPage && !isLoadingMore && nextCursor) {
        fetchOrders(nextCursor, false);
      }
    }, 100); // Throttle to 100ms
  }, [hasNextPage, isLoadingMore, nextCursor, fetchOrders]);

  // Initial load
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Form handlers
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/api/purchase-orders`, {
        ...formData,
        quantity: parseInt(formData.quantity),
        unit_price: parseFloat(formData.unit_price)
      });
      setFormData({
        item_name: '',
        order_date: '',
        delivery_date: '',
        quantity: '',
        unit_price: ''
      });
      setShowForm(false);
      cache.clear();
      await fetchOrders(null, true);
      showToast('Purchase order created successfully!');
    } catch (err) {
      setError('Failed to create purchase order');
      console.error(err);
    }
  };

  const handleDeleteClick = (item) => {
    setItemToDelete(item);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;
    
    try {
      // Immediately start animation
      setDeletingItems(prev => new Set([...prev, itemToDelete.id]));
      setShowDeleteModal(false);
      
      // Remove from UI state immediately for smooth transition
      setItems(prev => prev.filter(item => item.id !== itemToDelete.id));
      
      // Perform delete in background
      await axios.delete(`${API_URL}/api/purchase-orders/${itemToDelete.id}`);
      
      // Clean up and show success
      setDeletingItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(itemToDelete.id);
        return newSet;
      });
      showToast('Order deleted successfully!');
      setItemToDelete(null);
      
    } catch (err) {
      // On error, restore the item to the list
      setError('Failed to delete purchase order');
      setDeletingItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(itemToDelete.id);
        return newSet;
      });
      // Restore item on error
      cache.clear();
      fetchOrders(null, true);
      console.error(err);
    }
  };

  // Utility functions
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  // Loading Spinner Component
  const LoadingSpinner = ({ size = 'default' }) => {
    const sizeClasses = {
      small: 'h-4 w-4',
      default: 'h-6 w-6',
      large: 'h-8 w-8'
    };

    return (
      <div className={`inline-block ${sizeClasses[size]} animate-spin rounded-full border-2 border-solid border-blue-600 border-r-transparent`}></div>
    );
  };

  // Swipeable Card Component
  const SwipeableCard = ({ item, onDelete, children }) => {
    const [swipeX, setSwipeX] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [isRevealed, setIsRevealed] = useState(false);
    const startX = useRef(0);
    const cardRef = useRef(null);
    const cardWidth = useRef(0);

    useEffect(() => {
      if (cardRef.current) {
        cardWidth.current = cardRef.current.offsetWidth;
      }
    }, []);

    const handleStart = useCallback((clientX) => {
      setIsDragging(true);
      startX.current = clientX;
      if (cardRef.current) {
        cardWidth.current = cardRef.current.offsetWidth;
      }
    }, []);

    const handleMove = useCallback((clientX) => {
      if (!isDragging) return;

      const deltaX = clientX - startX.current;
      const maxSwipe = cardWidth.current * 0.6; // Limit swipe distance
      const clampedDelta = Math.max(-maxSwipe, Math.min(0, deltaX));
      
      setSwipeX(clampedDelta);
      setIsRevealed(Math.abs(clampedDelta) > cardWidth.current * SWIPE_THRESHOLD);
    }, [isDragging]);

    const handleEnd = useCallback(() => {
      setIsDragging(false);
      
      if (Math.abs(swipeX) > cardWidth.current * SWIPE_THRESHOLD) {
        // Activate delete
        onDelete(item);
        setSwipeX(0);
        setIsRevealed(false);
      } else {
        // Snap back
        setSwipeX(0);
        setIsRevealed(false);
      }
    }, [swipeX, onDelete, item]);

    // Mouse events
    const handleMouseDown = (e) => {
      e.preventDefault();
      handleStart(e.clientX);
    };

    const handleMouseMove = (e) => {
      handleMove(e.clientX);
    };

    const handleMouseUp = () => {
      handleEnd();
    };

    // Touch events
    const handleTouchStart = (e) => {
      handleStart(e.touches[0].clientX);
    };

    const handleTouchMove = (e) => {
      handleMove(e.touches[0].clientX);
    };

    const handleTouchEnd = () => {
      handleEnd();
    };

    useEffect(() => {
      if (isDragging) {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('touchmove', handleTouchMove);
        document.addEventListener('touchend', handleTouchEnd);

        return () => {
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
          document.removeEventListener('touchmove', handleTouchMove);
          document.removeEventListener('touchend', handleTouchEnd);
        };
      }
    }, [isDragging, handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd]);

    return (
      <div className="relative overflow-hidden">
        {/* Delete Background */}
        <div 
          className={`absolute inset-y-0 right-0 bg-red-500 flex items-center justify-center transition-all duration-200 ${
            isRevealed ? 'bg-red-600' : ''
          }`}
          style={{ 
            width: Math.abs(swipeX),
            opacity: Math.min(1, Math.abs(swipeX) / (cardWidth.current * 0.3))
          }}
        >
          <svg
            className="w-6 h-6 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </div>

        {/* Card Content */}
        <div
          ref={cardRef}
          className={`relative transition-transform ${
            isDragging ? 'transition-none' : 'transition-transform duration-300 ease-out'
          }`}
          style={{
            transform: `translateX(${swipeX}px)`,
            cursor: isDragging ? 'grabbing' : 'default'
          }}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
        >
          {children}
        </div>
      </div>
    );
  };

  // Card Component for Purchase Orders
  const PurchaseOrderCard = ({ item, index }) => {
    if (!item) {
      // Loading skeleton card
      return (
        <div className="rounded-lg shadow-md border border-gray-200 p-6 mx-4 mb-4 w-full">
          <div className="animate-pulse">
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="h-6 bg-gray-300 rounded w-48 mb-2"></div>
                <div className="h-4 bg-gray-300 rounded w-24"></div>
              </div>
              <div className="h-8 bg-gray-300 rounded w-16"></div>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <div className="h-4 bg-gray-300 rounded w-20 mb-1"></div>
                <div className="h-5 bg-gray-300 rounded w-24"></div>
              </div>
              <div>
                <div className="h-4 bg-gray-300 rounded w-20 mb-1"></div>
                <div className="h-5 bg-gray-300 rounded w-24"></div>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <div>
                <div className="h-4 bg-gray-300 rounded w-16 mb-1"></div>
                <div className="h-6 bg-gray-300 rounded w-20"></div>
              </div>
              <div className="h-8 bg-gray-300 rounded w-16"></div>
            </div>
          </div>
        </div>
      );
    }

    const totalPrice = item.total_price;
    const isPriceHigh = totalPrice > 1000;
    const isDeleting = deletingItems.has(item.id);

    const cardContent = (
      <div className={`rounded-lg shadow-md hover:shadow-lg transition-all duration-300 ease-in-out border border-gray-200 p-6 mx-4 mb-4 overflow-hidden ${
        isDeleting ? 'opacity-0 scale-95 max-h-0 p-0 m-0 border-0' : 'opacity-100 scale-100 max-h-96'
      }`}>
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 truncate">
              {item.item_name}
            </h3>
            <p className="text-sm text-gray-500 mt-1">Order #{item.id}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
            isPriceHigh 
              ? 'bg-purple-100 text-purple-800' 
              : 'bg-green-100 text-green-800'
          }`}>
            {isPriceHigh ? 'High Value' : 'Standard'}
          </span>
        </div>

        {/* Dates Section */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="border rounded-md p-3">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Order Date</p>
            <p className="text-sm font-medium text-gray-900">{formatDate(item.order_date)}</p>
          </div>
          <div className="border rounded-md p-3">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Delivery Date</p>
            <p className="text-sm font-medium text-gray-900">{formatDate(item.delivery_date)}</p>
          </div>
        </div>

        {/* Quantity and Price Section */}
        <div className="flex justify-between items-center mb-4">
          <div className="flex space-x-6">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Quantity</p>
              <p className="text-lg font-semibold text-gray-900">{item.quantity}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Unit Price</p>
              <p className="text-lg font-semibold text-gray-900">{formatCurrency(item.unit_price)}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Total</p>
            <p className={`text-xl font-bold ${isPriceHigh ? 'text-purple-600' : 'text-green-600'}`}>
              {formatCurrency(totalPrice)}
            </p>
          </div>
        </div>

        {/* Swipe instruction */}
        <div className="text-center pt-2 border-t border-gray-100">
          <p className="text-xs text-gray-400">← Swipe left to delete</p>
        </div>
      </div>
    );

    if (isDeleting) {
      return cardContent;
    }

    return (
      <SwipeableCard item={item} onDelete={handleDeleteClick}>
        {cardContent}
      </SwipeableCard>
    );
  };

  // Delete Confirmation Modal
  const DeleteModal = () => {
    if (!showDeleteModal || !itemToDelete) return null;

    return (
      <div className="fixed inset-0 z-50 overflow-y-auto">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm transition-opacity duration-300"
          onClick={() => setShowDeleteModal(false)}
        />
        
        {/* Modal */}
        <div className="flex min-h-full items-center justify-center p-4">
          <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full transform transition-all duration-300 scale-100">
            <div className="p-6">
              <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-red-100 rounded-full">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              
              <h3 className="text-lg font-medium text-gray-900 text-center mb-2">
                Delete Purchase Order
              </h3>
              
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <h4 className="font-medium text-gray-900 mb-2">{itemToDelete.item_name}</h4>
                <div className="text-sm text-gray-600 space-y-1">
                  <p>Order #{itemToDelete.id}</p>
                  <p>Quantity: {itemToDelete.quantity}</p>
                  <p>Total: {formatCurrency(itemToDelete.total_price)}</p>
                </div>
              </div>
              
              <p className="text-sm text-gray-500 text-center mb-6">
                This action cannot be undone. The order will be permanently deleted.
              </p>
              
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors duration-200"
                >
                  Delete Order
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Toast Notification
  const Toast = () => {
    if (!toast) return null;

    return (
      <div className="fixed top-4 right-4 z-50 animate-slide-in">
        <div className={`rounded-lg shadow-lg p-4 text-white ${
          toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
        }`}>
          <div className="flex items-center">
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
              {toast.type === 'success' ? (
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              ) : (
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              )}
            </svg>
            {toast.message}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-gray-900">Purchase Orders</h1>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <div className="mb-6">
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
          >
            {showForm ? 'Cancel' : 'New Purchase Order'}
          </button>
        </div>

        {showForm && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Create Purchase Order</h2>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Item Name
                </label>
                <input
                  type="text"
                  name="item_name"
                  value={formData.item_name}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Quantity
                </label>
                <input
                  type="number"
                  name="quantity"
                  value={formData.quantity}
                  onChange={handleInputChange}
                  required
                  min="1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Unit Price
                </label>
                <input
                  type="number"
                  name="unit_price"
                  value={formData.unit_price}
                  onChange={handleInputChange}
                  required
                  step="0.01"
                  min="0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="w-full flex items-center justify-between">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Order Date
                  </label>
                  <input
                    type="date"
                    name="order_date"
                    value={formData.order_date}
                    onChange={handleInputChange}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Delivery Date
                  </label>
                  <input
                    type="date"
                    name="delivery_date"
                    value={formData.delivery_date}
                    onChange={handleInputChange}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition-colors duration-200"
                >
                  Create Order
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <LoadingSpinner size="large" />
            <p className="mt-4 text-gray-600">Loading purchase orders...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <p className="text-gray-500">No purchase orders found. Create one to get started.</p>
          </div>
        ) : (
          <div>
            {/* Simple Card List with Infinite Scroll */}
            <div
              ref={containerRef}
              className="max-h-screen overflow-auto"
              onScroll={handleScroll}
            >
              <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 w-full'>
                {items.map((item, index) => {
                  const isDeleting = deletingItems.has(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`flex flex-col justify-start col-span-1 max-w-lg mx-auto w-full transition-all duration-300 ease-in-out ${
                        isDeleting ? 'opacity-0 scale-95 max-h-0 overflow-hidden' : 'opacity-100 scale-100 max-h-none'
                      }`}
                    >
                      <PurchaseOrderCard item={item} index={index} />
                    </div>
                  );
                })}
              </div>

              {/* Loading indicator for infinite scroll */}
              {isLoadingMore && (
                <div className="flex items-center justify-center py-8">
                  <div className="flex items-center space-x-3 text-blue-600">
                    <LoadingSpinner size="default" />
                    <span className="text-sm font-medium">Loading more orders...</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Delete Modal */}
      <DeleteModal />

      {/* Toast Notification */}
      <Toast />

      <style jsx>{`
        @keyframes slide-in {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}

export default App;