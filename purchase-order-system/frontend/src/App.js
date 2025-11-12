import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// Constants for virtualization and performance
const ITEM_HEIGHT = 80; // Height of each row in pixels
const LIST_HEIGHT = 600; // Height of the virtualized list container
const PAGE_SIZE = 20; // Number of items to fetch per page
const PREFETCH_THRESHOLD = 0.8; // Start prefetching when 80% scrolled
const CACHE_SIZE = 1000; // Maximum number of items to keep in cache
const BUFFER_SIZE = 0; // Number of extra items to render above/below visible area

function App() {
  // State management
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [hasNextPage, setHasNextPage] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [scrollTop, setScrollTop] = useState(0);
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

  // Calculate visible items
  const visibleRange = useMemo(() => {
    const itemsPerPage = Math.ceil(LIST_HEIGHT / ITEM_HEIGHT);
    const startIndex = Math.floor(scrollTop / ITEM_HEIGHT);
    const endIndex = Math.min(
      items.length - 1,
      startIndex + itemsPerPage + BUFFER_SIZE * 2
    );
    const adjustedStartIndex = Math.max(0, startIndex - BUFFER_SIZE);

    return {
      start: adjustedStartIndex,
      end: Math.max(adjustedStartIndex, endIndex),
      totalHeight: items.length * ITEM_HEIGHT,
      offsetY: adjustedStartIndex * ITEM_HEIGHT
    };
  }, [scrollTop, items.length]);

  // Get visible items
  const visibleItems = useMemo(() => {
    return items.slice(visibleRange.start, visibleRange.end + 1);
  }, [items, visibleRange.start, visibleRange.end]);

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
        setScrollTop(0);
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

  // Handle scroll events
  const handleScroll = useCallback((e) => {
    const container = e.target;
    const newScrollTop = container.scrollTop;
    setScrollTop(newScrollTop);

    // Intelligent prefetching
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;
    const scrollPercentage = (newScrollTop + clientHeight) / scrollHeight;

    if (scrollPercentage >= PREFETCH_THRESHOLD && hasNextPage && !isLoadingMore && nextCursor) {
      const prefetchCursor = nextCursor;
      const cacheKey = `orders_${prefetchCursor}`;
      
      if (!cache.has(cacheKey) && !prefetchingRef.current.has(cacheKey)) {
        fetchOrders(prefetchCursor, false);
      }
    }

    // Infinite scroll trigger
    const distanceFromBottom = scrollHeight - (newScrollTop + clientHeight);
    if (distanceFromBottom < 200 && hasNextPage && !isLoadingMore) {
      fetchOrders(nextCursor, false);
    }
  }, [hasNextPage, isLoadingMore, nextCursor, cache, fetchOrders]);

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
    } catch (err) {
      setError('Failed to create purchase order');
      console.error(err);
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this purchase order?')) {
      try {
        await axios.delete(`${API_URL}/api/purchase-orders/${id}`);
        cache.clear();
        await fetchOrders(null, true);
      } catch (err) {
        setError('Failed to delete purchase order');
        console.error(err);
      }
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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-gray-900">Purchase Orders</h1>
          <p className="mt-2 text-sm text-gray-600">Manage and track your purchase orders</p>
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
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
            <p className="mt-2 text-gray-600">Loading purchase orders...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <p className="text-gray-500">No purchase orders found. Create one to get started.</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow">
            {/* Header */}
            <div className="grid grid-cols-6 gap-4 px-6 py-3 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200">
              <div>Item Name</div>
              <div>Order Date</div>
              <div>Delivery Date</div>
              <div>Quantity</div>
              <div>Unit Price</div>
              <div>Total Price</div>
            </div>

            {/* Virtualized Scrollable Area */}
            <div
              ref={containerRef}
              className="relative overflow-auto"
              style={{ height: LIST_HEIGHT }}
              onScroll={handleScroll}
            >
              {/* Virtual spacer for total height */}
              <div style={{ height: visibleRange.totalHeight }}>
                {/* Rendered items */}
                <div
                  style={{
                    transform: `translateY(${visibleRange.offsetY}px)`,
                    position: 'relative'
                  }}
                >
                  {visibleItems.map((item, index) => {
                    const actualIndex = visibleRange.start + index;
                    return (
                      <div
                        key={item ? `${item.id}-${actualIndex}` : `loading-${actualIndex}`}
                        className="border-b border-gray-200 hover:bg-gray-50 transition-colors"
                        style={{ height: ITEM_HEIGHT }}
                      >
                        {item ? (
                          <div className="px-6 py-4 h-full flex items-center">
                            <div className="grid grid-cols-6 gap-4 items-center w-full">
                              <div className="font-medium text-gray-900 truncate">
                                {item.item_name}
                              </div>
                              <div className="text-sm text-gray-600">
                                {formatDate(item.order_date)}
                              </div>
                              <div className="text-sm text-gray-600">
                                {formatDate(item.delivery_date)}
                              </div>
                              <div className="text-sm text-gray-600">
                                {item.quantity}
                              </div>
                              <div className="text-sm text-gray-600">
                                {formatCurrency(item.unit_price)}
                              </div>
                              <div className="flex justify-between items-center">
                                <div className="text-sm font-medium text-gray-900">
                                  {formatCurrency(item.total_price)}
                                </div>
                                <button
                                  onClick={() => handleDelete(item.id)}
                                  className="text-red-600 hover:text-red-800 transition-colors duration-200 text-sm"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          // Loading skeleton
                          <div className="px-6 py-4 h-full flex items-center">
                            <div className="animate-pulse grid grid-cols-6 gap-4 w-full">
                              <div className="h-4 bg-gray-300 rounded"></div>
                              <div className="h-4 bg-gray-300 rounded"></div>
                              <div className="h-4 bg-gray-300 rounded"></div>
                              <div className="h-4 bg-gray-300 rounded"></div>
                              <div className="h-4 bg-gray-300 rounded"></div>
                              <div className="h-4 bg-gray-300 rounded"></div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;